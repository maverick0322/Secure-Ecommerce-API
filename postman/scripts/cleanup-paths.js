'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ensure, validateRunId } = require('./isolation');

// The reports tree must be private to the runner user. Node has no portable
// openat/unlinkat API: do not use a tree writable by untrusted local users.
function openRun(reports, runId) {
  validateRunId(runId);
  const base = path.resolve(reports);
  const directory = path.join(base, runId);
  function checkParents() {
    let current = path.parse(directory).root;
    for (const part of directory.slice(current.length).split(path.sep)) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_REPORT_DIRECTORY');
    }
    ensure(fs.realpathSync(directory) === directory, 'UNSAFE_REPORT_DIRECTORY');
  }
  function file(name, optional = false) {
    checkParents();
    ensure(['state.json', 'private.postman_environment.json'].includes(name), 'INVALID_REPORT_FILE');
    const target = path.join(directory, name);
    let stat;
    try { stat = fs.lstatSync(target); } catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    }
    ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'UNSAFE_REPORT_FILE');
    return target;
  }
  function readState() {
    const target = file('state.json');
    const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const opened = fs.fstatSync(fd), current = fs.lstatSync(target);
      ensure(opened.isFile() && opened.nlink === 1 && opened.ino === current.ino && opened.dev === current.dev,
        'REPORT_FILE_CHANGED');
      checkParents();
      return JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
  }
  function validateArtifacts() {
    file('state.json'); file('private.postman_environment.json', true);
    checkParents();
    const workspace = path.join(directory, 'workspace');
    const stat = optionalStat(workspace);
    if (stat) {
      ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_WORKSPACE');
      const link = path.join(workspace, 'node_modules');
      const linked = optionalStat(link);
      if (linked) ensure(linked.isSymbolicLink(), 'UNEXPECTED_DEPENDENCY_LINK');
    }
  }
  function cleanFiles(state) {
    validateArtifacts();
    const privateFile = file('private.postman_environment.json', true);
    if (privateFile) fs.unlinkSync(privateFile);
    checkParents();
    const link = path.join(directory, 'workspace', 'node_modules');
    if (optionalStat(link)) {
      validateArtifacts(); fs.unlinkSync(link); // unlink the junction itself, never its target
    }
    file('state.json');
    const temporary = path.join(directory, 'state-' + randomUUID() + '.tmp');
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(state, null, 2) + '\n'); } finally { fs.closeSync(fd); }
    checkParents(); file('state.json');
    fs.renameSync(temporary, path.join(directory, 'state.json'));
  }
  checkParents();
  return { readState, validateArtifacts, cleanFiles };
}
module.exports = { openRun };

function optionalStat(target) {
  try { return fs.lstatSync(target); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
