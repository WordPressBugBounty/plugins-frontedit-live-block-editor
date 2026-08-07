# Custom Handlers (Experimental)

This template is a starter plugin for adding FrontEdit support to a custom
Gutenberg block. Test custom handlers on staging before using them on
production content.

## Before you begin

Your target block must be registered in the browser on the editable frontend
page, including its original attributes and `save` implementation. FrontEdit
uses `wp.blocks.parse()` and `wp.blocks.serialize()` to preserve native block
content.

Open the frontend page while logged in and run:

```js
wp.blocks.getBlockType( 'your-namespace/your-block' )
```

If that returns `undefined`, the block is not compatible yet. Do not enqueue
the provider's editor-only script from this template. It may require WordPress
admin APIs and is not a supported frontend serialization API.

Read `docs/custom-handler-schema-reference.md` in the installed FrontEdit
plugin before writing a handler. It is the complete public schema reference,
including compatibility requirements, component bindings, toolbar operations,
optional UI, and validation steps.

## Setup

1. Copy this template folder into `wp-content/plugins/`.
2. Rename the copied folder and activate it in WordPress.
3. Edit `handlers/custom-frontedit-handlers.php`.
4. Rename the example PHP classes so they are unique.
5. Replace the example block name, labels, selectors, bindings, and schema with
   the contract for your block.

The bootstrap file registers the handler file through the
`mwpsfe_external_handler_files` filter. FrontEdit loads it after built-in
handlers, so using an existing handler ID intentionally replaces that handler.

## Included files

- `frontedit-live-block-editor-custom-handlers.php` - plugin bootstrap.
- `handlers/custom-frontedit-handlers.php` - a copyable edit/comment handler
  example.

Handler files must begin with:

```php
<?php
namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;
```

For the full contract and test checklist, use the installed FrontEdit guide:
`docs/custom-handler-schema-reference.md`.
