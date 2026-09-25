# PHP Integration Contract (V1)

This document defines the stable server-side boundary for trusted WordPress
plugins that integrate with FrontEdit.

## Public facade

The only supported PHP entry point for FrontEdit runtime consumers is:

```php
\MWPSFE\MWPSFE_Public_API::instance();
```

The facade returns data snapshots. Consumers must not instantiate FrontEdit's
handler registry, permissions service, block renderer, operation projector, or
handler/schema interfaces, and must not read FrontEdit Pro database classes.

`get_api_info()` returns API version `1` and feature flags for authorized post
and block context, the handler catalog, public operation contracts,
pending-draft state, rendering, the public ability catalog, and settings
notices. `pendingDraftState` is false when an
older loaded Pro add-on has not registered its provider. Consumers should
verify the version and the features they require before booting.

`get_icon_library()` returns the registered WordPress icons as `{name, label}`
records. The names are the only legal values for the `core/icon` media
replacement operation's `url` input. The public operation contract also
advertises them in that operation's `values` array, so callers can constrain
generated edits without accessing the registry directly. Icon names are not
attachment IDs or external URLs.

## Authorized editable-block context

`get_authorized_post_context( $post_id )` returns the current user's effective
permissions and basic saved post context without constructing the block
catalog. Use it for lightweight access decisions.

```php
$context = \MWPSFE\MWPSFE_Public_API::instance()
	->get_authorized_editable_block_context( $post_id, $dirty_changes );
```

The current user must have effective FrontEdit publish or draft permission for
the requested supported post. On success, the response includes:

- `post_id`, `title`, `preview_url`, and effective `permissions`;
- `effective_content`, with supplied browser dirty changes applied in memory;
- data-only schema edit-handler snapshots in `handlers`;
- flattened editable block records in `blocks`.

Each block record contains its UUID, parsed and serialized block snapshots,
rendered HTML, a data-only handler/schema snapshot, its public operation
contract, and its handler-derived current operation state. This projection is
read-only. Applying dirty changes here never updates the database or creates a
save path.

## Public operation contract

```php
$result = \MWPSFE\MWPSFE_Public_API::instance()
	->get_public_operation_contract( $post_id, $uuid, $dirty_changes );
```

This is the server-side read projection of operations FrontEdit declares for
the authorized block. It does not apply an operation. Browser integrations must
still discover and open the live editor, preflight through
`SFE.PublicApi.preflightOperations()`, and stage through
`SFE.PublicApi.applyOperations()`.

`applyOperations()` stages through FrontEdit's shared schema executor and does
not save. FrontEdit retains ownership of history, dirty state, preview, cancel,
and the user-driven save pipeline.

## Pending draft state

```php
$state = \MWPSFE\MWPSFE_Public_API::instance()
	->get_pending_draft_state( $post_id );
```

The response contains `pending_by_uuid`. Base returns an empty map. Pro supplies
its normalized draft read model through the FrontEdit-owned
`mwpsfe_public_api_pending_draft_state` filter and keeps database ownership
private. If Pro is loaded without that provider, the facade fails loudly so a
trusted integration cannot mistake unavailable draft state for an empty map.

## Handler and ability discovery

`get_editable_handler_catalog()` returns data-only schema edit-handler
snapshots keyed by handler ID. `get_public_ability_catalog()` returns metadata
from the same ability definitions FrontEdit registers, excluding callbacks.
Consumers should not maintain duplicate handler or ability catalogs.

## Rendering and settings integration

- `render_block()` renders one parsed block through WordPress's canonical block
  renderer.
- `render_serialized_block()` renders serialized markup through FrontEdit's
  display renderer for admin or email use.
- `set_settings_notice()` publishes a notice through FrontEdit's settings
  experience.

These methods keep the underlying implementation private and replace direct
cross-plugin class access.
