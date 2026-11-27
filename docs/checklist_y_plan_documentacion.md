# Checklist de Documentación Técnica y Plan de Seguimiento

**Ubicación:** `docs/checklist_y_plan_documentacion.md`  
**Documento maestro:** [`docs/asciidoc/index.adoc`](file:///c:/codigo/ps/ecommerce/backendnode/docs/asciidoc/index.adoc)  
**Línea base y hechos:** [`docs/BASELINE.md`](file:///c:/codigo/ps/ecommerce/backendnode/docs/BASELINE.md) y [`docs/asciidoc/_hechos.adoc`](file:///c:/codigo/ps/ecommerce/backendnode/docs/asciidoc/_hechos.adoc)  
**Stack vigente:** `frontendnet` (ASP.NET Core 9.0 MVC BFF) $\leftrightarrow$ `backendnode` (Node.js 24 LTS / Express / RS256 + Redis 8.2 TLS) $\leftrightarrow$ `mysql:8.4` TLS (3 VMs Ubuntu 24.04.5 LTS).

---

## 1. Estado por Capítulo (`docs/asciidoc/`)

| Capítulo | Archivo | Estado | Observaciones |
|---|---|---|---|
| **Prefacio e Introducción** | `01_introduccion.adoc` | **COMPLETADO** | Propósito, alcance dual `backendnode`/`frontendnet`, metodología S-SDLC y compuertas documentales. |
| **Requisitos (ERS)** | `02_requisitos.adoc` | **CASI COMPLETO** | `CU-01..18`, `RF-01..18`, `RN-01..12`, `RNF-01..08`, `RSG-01..10` y decisiones de alcance cerradas (`description NOT NULL`, `hasImage`, estado terminal de vendedores). **Pendiente:** reemplazar los 12 marcadores `[CAPTURA PENDIENTE]` con capturas reales. |
| **Diseño Arquitectónico** | `03_diseno_arquitectonico.adoc` | **COMPLETADO** | 26 diagramas UML 2.5.1 trazados 1:1 al código (`UC-00..03`, `STM-01..02`, `DER-C/L`, `CLS-BE/FE`, `SEQ-01..06`, `CMP-01`, `DEP-01`), renderizados SVG + PNG a 200 dpi. |
| **Modelado de Amenazas** | `04_modelado_amenazas.adoc` | **COMPLETADO** | `4` DFDs SVG integrados en `docs/asciidoc/assets/td_0*.svg`, modelo versionado en `docs/threat-model/secure-ecommerce-threat-model.json` y matriz STRIDE completa de `51` amenazas (`36` mitigadas, `15` abiertas: `2 High`, `7 Medium`, `6 Low`). |
| **Construcción Segura** | `05_construccion_segura.adoc` | **COMPLETADO** | Stack actual, BFF `.frontendnet`, JWT RS256 + Redis TLS single-use, `scrypt`, ORM parametrizado + `escapeLike`, Sharp en 6 capas, auditoría `audit_logs` y endurecimiento `compose.vm*`. |
| **Estándares de Codificación** | `06_estandares_codificacion.adoc` | **COMPLETADO** | Convenciones reales de Node.js 24 y C#/.NET 9, más mejoras propuestas (`ESLint`, `.editorconfig`, `coverlet`). |
| **Plan y Reporte de Pruebas** | `07_plan_pruebas.adoc` | **CASI COMPLETO (`PEN-05` verificado)** | Métricas locales completas verificadas (`backendnode`: `91/91` suites / `1,151/1,151` tests con `RUN_STAGE5_MYSQL=1` + `RUN_STAGE2_REDIS=1` + `stage5-historical-tests.js`, `95 % Stmts`, `98.11 % Lines`; `frontendnet`: `69/69` tests; CI en verde PR #10/#11/#12) más prueba de carga y lockout `PEN-05` con `grafana/k6:1.3.0` (`434/434` checks, `0` errores `5xx`). **Pendiente:** ejecución de `PEN-01..04` y `SCN-01..02` (`Nmap`/ZAP). |
| **Despliegue Seguro (3 VMs)** | `08_despliegue_seguro.adoc` | **COMPLETADO** | Topología `DEP-01` (`tienda.lan`, `api.tienda.lan`, `db.tienda.lan`), Apache 2 TLS 1.3, CA interna, `ufw` + `DOCKER-USER`, 15 `GRANT`s mínimos, `recover` de Redis, respaldo `mysqldump` y verificación viva. |
| **Conclusiones y Registro IDs** | `09_conclusiones.adoc`, `_registro_ids.adoc` | **COMPLETADO** | Conclusiones técnicas, trazabilidad única `[[ID]]` <-> `<<ID>>` y trabajo futuro acotado. |

---

## 2. Compuertas de Calidad Documental (`backendnode/docs/`)

- [x] `node docs/generate-inventory.js --update-baseline` actualizado sobre `eaf6616` / `90635a6` (`13` migraciones).
- [x] `node docs/generate-hechos.js` regenerado desde `docs/BASELINE.md`.
- [x] `node docs/generate-diagrams.js --format both` renderizando los 26 diagramas UML 2.5.1 (PlantUML `1.2024.8`).
- [x] `node docs/verify-traces.js` con 0 rutas faltantes, 0 símbolos faltantes y cabeceras `' TRACE:` válidas.
- [x] `node docs/verify-docs.js` superando las 6 compuertas (`1a..1f`) con 0 errores.
- [x] `node docs/build.js` compilando `backendnode/dist/index.html` sin advertencias AsciiDoctor.

---

## 3. Pendientes Explícitos Fuera de Este Cierre

1. **Pruebas ofensivas y escaneos restantes (Capítulo 7):** Corrida formal de `PEN-01..04` (payloads controlados) y `SCN-01..02` (`Nmap` / OWASP ZAP) — `PEN-05` (`k6` / `RNF-06`) ya completado y documentado.
2. **Capturas de pantalla (Capítulo 2):** Tomar las 12 capturas de interfaz en `https://tienda.lan/` e integrarlas en `docs/asciidoc/assets/` y `02_requisitos.adoc`.
