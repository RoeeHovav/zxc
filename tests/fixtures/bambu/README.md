# Bambu Studio / OrcaSlicer 3MF fixtures

These are **not** files exported by a real slicer. They were written by hand to match, line by
line, what the slicers' writer code produces. The writer is
`_BBS_3MF_Exporter::_add_slice_info_config_file_to_archive` in
`src/libslic3r/Format/bbs_3mf.cpp`, and the values are set in `PartPlateList::store_to_3mf_structure`
(`src/slic3r/GUI/PartPlate.cpp`). The sources checked, on 2026-09-26, were:

| Fixture                                 | Mirrors                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current-two-plates.slice_info.config`  | bambulab/BambuStudio `master`: header, full plate metadata, `<object>` per instance, `<filament>` with `tray_info_idx` / nozzle / usage flags, `<warning>` with its `error_code ="…"` spacing. Includes an out-of-order filament list, an 8-digit colour, XML entities, Hebrew text and a skipped object. |
| `v01.04-single-plate.slice_info.config` | BambuStudio tag `v01.04.00.17`: no objects, no `tray_info_idx`, no printer model.                                                                                                                                                                                                                         |
| `unsliced-project.slice_info.config`    | A project saved without valid slice results. The writer skips plates whose `is_sliced_valid` is false, so only the header is left.                                                                                                                                                                        |
| `no-weight.slice_info.config`           | The writer leaves `weight` empty when the total weight is 0, and `prediction` can be 0. Here the parser must fall back to per-filament grams and report the missing time.                                                                                                                                 |
| `project_settings.config`               | `Metadata/project_settings.config`, written as JSON by `save_to_json`. Values are strings or string arrays.                                                                                                                                                                                               |

OrcaSlicer (SoftFever/OrcaSlicer `main`) uses the same file paths and key names.

Units, from the writer code:

- `prediction` is whole seconds, in the "normal" time mode.
- `weight` and `used_g` are grams with 2 decimals.
- `used_m` is metres.

**If you have real exports**, add them next to these fixtures, for example a
`.gcode.3mf` from _File → Export → Export plate sliced file_. Then add a test that reads them.
Strip customer data from them first.
