---
name: Lace modules
description: How to edit the Terraform of a module that is also authored on the Lace canvas.
applyTo: "**/*.tf"
---

# Editing a Lace module's Terraform

A directory that holds a `.lace` folder is a Lace module. Its Terraform is authored at three levels that show the same module: the `.tf` files, the Lace canvas, and chat. These rules keep an edit to the `.tf` files in step with the canvas.

- **Generate pending canvas edits before editing `.tf` by hand.** Edits made on the canvas live in the canvas until Generate writes them to the `.tf` files. If the canvas has edits that have not been generated, ask the developer to Generate from the canvas first, then edit the files. A text edit made while such edits are pending is a conflict.
- **A conflict or a refused module is the developer's to resolve on the canvas.** When the `.tf` files change under canvas edits that are not generated, the canvas asks the developer to keep the canvas edits or reload the files; one side is taken whole. When the files do not parse, the canvas is read-only until they do. Do not pick a side or work around either state; say what happened and leave the choice to the developer.
- **A Lace module is in Lace style, and `lace module validate` says whether it still is.** Run it in the module's directory after editing the files, and fix what it reports. It is also what certifies the module for `lace stack apply`.
- **Generate does not keep comments or layout.** Generate renders the module from the canvas's own model: comments, blank lines, argument order and which file a block sits in are not carried through. Do not rely on a comment or a file layout surviving the next Generate.
- **A group on the canvas is a child module.** Grouping modules moves them into a local module directory that the parent calls. Treat such a directory as part of the module, not as a separate project.
- **Per-environment values are not in the module.** Pass them to the stack commands with `--var-file <file>` or `--var name=value` (`lace stack preview`, `lace stack apply`); do not write an environment's values into the module's `.tf` files.
