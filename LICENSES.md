# Licences in this repository

| path | licence | file |
|---|---|---|
| everything except the row below | AGPL-3.0-only | `LICENSE` |
| `packages/motion/` (hydra-motion) | MIT | `packages/motion/LICENSE`; SPDX `MIT` header on every file |

`LICENSE` (the AGPL text) is unchanged so tools still detect it. The MIT part is a separate work: a Hydra plugin that holds no
AGPL code and imports nothing from the rest of the repository (its tests check both), so it can be split out
(`packages/motion/EXTRACTING.md`). iDra uses only its built file, which carries the MIT licence in its header comment;
sketches exported "self-contained" inline that file, header included. Third-party code bundled in the apps is listed in
`README.md` under *Licence and third-party code*.
