=== FrontEdit - Live Frontend Block Editor ===
Contributors: maintainwp
Tags: frontend editor, front-end editing, gutenberg, block editor, inline editor
Requires at least: 7.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.3.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html

Make content updates easier. Now supporting Custom Post Types. Clients and teams can update live pages safely with zero wp-admin training.

== Description ==

## Why FrontEdit?

Most websites don't need a new page builder. They need a faster way to edit the blocks that already make up their pages.

FrontEdit is a frontend editor for WordPress that lets trusted users click directly on headings, paragraphs, images, buttons, lists, tables, and other supported content where it appears on the live page, make their changes in context, and save them through a focused front-end editing experience.

For site owners and marketing teams, that means faster everyday updates with less WordPress training. For agencies and freelancers, it means fewer routine support requests and a safer way to hand content ownership to clients.

FrontEdit works with native Gutenberg blocks rather than replacing them or editing only the rendered HTML. It updates supported block content and attributes while preserving the original block structure, styling, settings, and standard WordPress serialization.

### See FrontEdit in Action

https://www.youtube.com/watch?v=ZsCPpIiREa0

📺 **[Watch FrontEdit in action](https://www.youtube.com/watch?v=ZsCPpIiREa0)**
🎮 **[Try the interactive demo](https://maintainwp.com/products/frontedit/#see-frontedit-in-action)**
🔓 **[Explore FrontEdit Pro](https://maintainwp.com/products/frontedit/#explore-frontedit-pro)**

### At a glance

* ✏️ Edit Gutenberg blocks where they appear on the live page
* ⚡ Make routine text, image, button, list, table, and other block updates faster
* 🛡️ Preserve Gutenberg block markup, styling, and block-specific settings
* 👥 Give clients and team members a simpler alternative to navigating wp-admin
* 📉 Reduce routine support requests and accidental layout changes
* 🔌 Build custom integrations with the Public JavaScript API and extend block compatibility through custom handlers
* 🚀 Add drafts, approvals, customizable editing permissions, and more with FrontEdit Pro

### </> Built for Developers Too

* **Build on top of FrontEdit.** Stable JavaScript and PHP public APIs let plugins, custom tools, and AI assistants discover authorized editor capabilities and safely stage the same block editing operations used by FrontEdit itself.
* **Extend compatible blocks.** A schema-driven custom block handler system lets developers add front-end editing support for compatible custom Gutenberg blocks without modifying the plugin core.

= FrontEdit brings WordPress front-end editing to the place it belongs: the front end. =

Edit a single block or work across multiple blocks. Each block keeps its own active editing session and undo history, letting you jump between blocks while preserving the state of every edit in progress.

WordPress is powerful, but for everyday content updates it often asks too much of the people actually doing the work. Clients get lost in wp-admin. Teams bounce between the page preview and the editor. Small copy changes turn into support requests. Agencies spend valuable time handling edits their clients should be able to make themselves.

FrontEdit changes that.

Instead of sending users into the dashboard to hunt through blocks, sidebars, and settings panels, FrontEdit lets trusted users click directly on the content they want to change and edit it right on the page. Headlines, paragraphs, lists, buttons, media, and more become part of a guided frontend workflow that feels natural, lightweight, and immediate.

FrontEdit complements Gutenberg by bringing block editing directly to the front end.

Whether you manage your own website, run content updates for a business, or maintain dozens of client sites, FrontEdit creates a new kind of WordPress workflow: faster, clearer, and dramatically easier to delegate.

### 💡 Why It Matters

Most content edits are simple.

They are not redesigns. They are not full page rebuilds. They are things like:

* Updating a headline after a campaign changes
* Rewriting a paragraph on a service page
* Swapping an image or fixing a button label
* Refreshing lists, pricing copy, FAQs, and promotions
* Letting a client suggest or submit changes without risking layout damage

These edits happen constantly, but traditional WordPress workflows make them slower than they should be.

FrontEdit removes the friction. Your content can be updated in context, on the live page, with far less training and far less back-and-forth.

Every edit preserves the original WordPress block markup and block-specific settings. FrontEdit updates only the content you change, allowing supported blocks to retain their existing configuration, styling, and behavior.

= ✨ Key Features =

* Edit WordPress blocks directly from the front end
* Click content exactly where it appears on the page
* Preserve block markup, styling, and block-specific settings
* Supports text, images, tables, buttons, media, and more
* Built for Gutenberg's normal block serialization
* Lightweight editing experience designed for trusted users
* Let users submit block-linked content requests by email
* Public JavaScript API for custom integrations and AI workflows
* Extensible custom block handler system for compatible custom blocks

### 👥 A Better Workflow For Real Teams

FrontEdit is ideal for:

* Business and site owners who want to make quick updates themselves
* Marketing teams that need to keep landing pages, service pages, and calls to action current
* Internal staff who should be able to edit content without learning WordPress admin
* Freelancers and agencies that want to give clients safe, straightforward content ownership
* Maintenance teams that are tired of spending time on small text and image changes

For agencies, the value is especially clear. Instead of fielding routine requests like "change this sentence," "swap this image," or "update this CTA," you can give clients a workflow they can actually use with confidence.

That means fewer support tickets, fewer admin walkthroughs, fewer accidental layout changes, and more time spent on higher-value work.

### ⚙️ How It Works

1. Install and activate FrontEdit.
2. Open a page on the front end while logged in.
3. Click supported content directly on the page.
4. Edit in place and save using a workflow designed to respect WordPress block content.

The result is a familiar page view combined with a purpose-built editing layer that keeps the experience simple for the person making the change.

FrontEdit focuses on the block types people edit every day, with support continuing to expand over time.

### 🧱 Supported Blocks

FrontEdit currently supports a growing set of WordPress blocks.

#### WordPress Core

**Text blocks**

* Paragraph (`core/paragraph`)
* Heading (`core/heading`)
* List (`core/list`)
* Code (`core/code`)
* Details (`core/details`)
* Preformatted (`core/preformatted`)
* Pullquote (`core/pullquote`)
* Table (`core/table`)
* Verse (`core/verse`)

**Media blocks**

* Image (`core/image`)
* Audio (`core/audio`)
* Cover (`core/cover`)
* File (`core/file`)
* Media & Text (`core/media-text`)
* Video (`core/video`)
* Icon (`core/icon`)

**Design blocks**

* Accordion Heading (`core/accordion-heading`)
* Button (`core/button`)

### 🧩 Extensible With Custom Block Handlers

FrontEdit includes a schema-driven handler system that allows developers to add front-end editing support for compatible custom blocks and third-party block libraries.

Using the included documentation and handler templates, developers can define which parts of a block are editable and how FrontEdit should safely apply those changes without modifying the plugin core.

Custom handler support is currently experimental and has not been tested with every block library or custom implementation. A third-party block is compatible only when its provider registers the block's client-side attributes and save implementation on the editable frontend page. Editor-only provider bundles are not compatible with FrontEdit.

Before creating custom handlers, review `docs/custom-handler-schema-reference.md` and the included `templates/frontedit-live-block-editor-custom-handlers/README.md`. They contain the serialization prerequisite, schema contract, supported capabilities, limitations, and validation guidance.

If you create a reliable handler for a popular third-party block library, you are welcome to submit it for consideration. After testing and validation, compatible handlers may be included in a future release as officially supported integrations.

### 🔗 Built For Gutenberg, Not Against It

FrontEdit edits supported block content and attributes while preserving the standard serialization and save behavior WordPress expects.

It complements the block editor rather than replacing it, allowing everyday changes to happen on the front end while the underlying content remains standard Gutenberg block content.

### 🛡️ Safety That Protects Real Work

Front-end editing has to be convenient, but it also has to protect work already in progress.

FrontEdit includes safeguards for common editing conflicts:

* **Post-lock protection**: When another user is actively editing a post, FrontEdit identifies the editor and requires an explicit takeover before live changes can be applied.
* **Unsaved changes warnings**: FrontEdit warns users before they reload, navigate away, or otherwise leave a post with unsaved changes.
* **Overwrite protection**: If another user updates the page after editing began, FrontEdit can warn the current editor before newer changes are overwritten.

### 🔌 Developer API

FrontEdit includes a stable Public JavaScript API for developers who want to integrate with or extend the front end editing experience.

The versioned Public API provides documented runtime contracts for interacting with the editor, inspecting supported blocks, applying schema-backed content and attribute updates, working with media and list operations, responding to editor lifecycle events, and building integrations designed for long-term compatibility. `getListOperationContract()` exposes the FrontEdit-owned list operation and input descriptor so integrations do not maintain parallel list-operation maps. Server-side AI integrations can also read handler-derived current operation state for text, media, host links, and settings without reconstructing a parallel block-attribute map.

The Icon block uses WordPress's Icon Library. The public API advertises registered icon names, loads their SVG previews, and stages a selected icon through the same FrontEdit review and save flow as other supported blocks.

Whether you're building custom editing tools, AI-powered workflows, or integrations with your own plugins, the Public API is the recommended way to interact with FrontEdit at runtime.

The complete API reference is included with the plugin in `docs/frontend-runtime-extension-contract.md`, which documents the available methods, events, supported runtime behavior, versioning guarantees, and integration guidelines for developers.

### 🔓 Pro Features When You Need More

FrontEdit is a free WordPress frontend editor for supported Gutenberg blocks. FrontEdit Pro adds workflows for teams that need drafts, approvals, permissions, history, centralized content management, and more.

Batch editing is included in FrontEdit for users with editing access. Pro lets an administrator decide which users may edit several blocks in one session and which users must edit one block at a time.

With Pro, you can unlock advanced features such as:

* Pending drafts and content approval workflows
* Per-user controls for choosing single-block or batch editing
* Per-user editing permissions for more controlled client access
* Content request ticketing system to track and respond to user-submitted change requests
* Centralized content management with a Content Catalog for reviewing editable elements across the site
* Block-level edit history and revert workflows
* Notification tools for more collaborative editorial operations
* A centralized dashboard for open requests and pending drafts

👉 **[See everything included in FrontEdit Pro](https://maintainwp.com/products/frontedit/#compare-free-vs-pro)**

### 🚧 Expanding Front-End Editing

FrontEdit is built around editing the content and settings of existing blocks. Future Pro releases are planned to expand that workflow with capabilities such as moving, deleting, and adding blocks directly from the front end, fully customizable through admin-managed user permissions.

The goal is to support more complete page-editing workflows for trusted, more technical users, while maintaining the secure, controlled experience FrontEdit is designed for.

### 🤖 Coming Soon: ABE, Your Personal WordPress Assistant

ABE, the AI Assisted Block Editor, is being built as a free companion to FrontEdit that makes updating WordPress content simpler and more guided.

ABE will offer two ways to work:

* AI mode (BYOK): Connect a supported AI provider through your WordPress AI connector and use natural-language requests to help rewrite, generate, and update supported blocks.
* AI-free mode: Use the same chat-style interface without AI. ABE guides you through available editing actions and helps you make changes through a simpler, more structured workflow.

In either mode, ABE works with FrontEdit-supported blocks and stages proposed changes for you to review and apply. It will not blindly update your page and save on its own.

Join the ABE waitlist here to get updates and be notified when ABE launches:
[Sign up here](https://maintainwp.com/abe-waitlist-signup-page/)

== Installation ==

1. Upload the `frontedit-live-block-editor` folder to the `/wp-content/plugins/` directory, or install the plugin through the WordPress Plugins screen.
2. Activate **FrontEdit** through the `Plugins` screen in WordPress.
3. Visit a page while logged in and begin editing blocks directly on the front end.

== Frequently Asked Questions ==

= Does this replace the block editor in wp-admin? =

No. FrontEdit complements the block editor by bringing everyday block editing to the front end.

= Who can edit content from the front end? =

Only users who would be able to edit the page in the block editor can edit that page from the front end.

= Does this plugin affect site performance for visitors? =

No. FrontEdit only loads its assets for logged-in users who already have permission to edit that specific page or post. For regular public visitors, the plugin is completely invisible and adds zero weight to your page load.

= Is this useful for agencies? =

Yes. It is especially helpful for agencies and WordPress maintenance providers who want clients to handle routine content edits themselves without navigating wp-admin.

= What kinds of content can be edited? =

FrontEdit edits the supported Gutenberg blocks listed above when they are stored in a standard WordPress post or page's content. It does not edit every block, custom data source, or arbitrary page content.

= Does FrontEdit support custom post types or custom fields? =

FrontEdit supports publicly viewable custom post types that use the WordPress block editor and store editable blocks in normal `post_content`. It does not matter whether ACF, Meta Box, or another tool registered the post type.

FrontEdit edits supported Gutenberg blocks in that main content area. It does not edit ACF, Meta Box, or other custom-field values; flexible-content layouts; block-bound post meta; or third-party page-builder layouts.


= What does Pro add? =

FrontEdit Base sends each block-linked content request directly to the administrator by email. FrontEdit Pro adds the centralized workflow for tracking, responding to, closing, and searching those requests, alongside drafts, approvals, per-user controls for single or batch editing, a dashboard, content catalog tools, and element history.

= Is AI included? =

AI is optional. ABE, the AI Assisted Block Editor for FrontEdit, will be available for free and can be used in two modes.

If you connect an AI provider through your WordPress AI connector, ABE can use it to assist with natural-language block updates. You can also use ABE entirely without AI through its guided editing workflow.

In both cases, changes are staged for your review before you save them.

[Join the ABE waitlist](https://maintainwp.com/abe-waitlist-signup-page/)

== Screenshots ==

1. Hover over a heading
2. Edit heading block
3. Choose an image to edit it
4. Replace an image from the library or upload a new file
5. Full list editing capabilities including indent/outdent
6. Edit table blocks
7. After updating table alignment, column alignment, and adding a caption
8. Choose your target block when blocks are overlapping
9. Write a comment to the admin with a content request

== Changelog ==

= 1.3.0 =
* Changed public anchor-backed rich-text runs to expose semantic new-tab and no-follow booleans while keeping saved anchor attributes private to FrontEdit.
* Declared button link new-tab and no-follow operation inputs as JSON booleans and unified native and public link rendering through the same schema-backed helper.
* Fix stale link action bar when switching anchors.
* Fixed list saves leaving selection listeners attached to the replaced editor, which caused errors when selecting text in other blocks.
* Added a stable PHP API for secure integrations with FrontEdit's editing, draft, rendering, and operation workflows.
* Added public Icon Library discovery and validated icon-name staging for Icon blocks, including SVG previews for third-party integrations.
* Fixed an issue where deleting a space between differently formatted words in a button block would create a second link inside the button's link.

= 1.2.0 =
* Overhauled the Public JavaScript API with handler-declared operation contracts that expose only the operations, inputs, formats, and allowed values supported by each editable block.
* Replaced the separate public text, media, block-attribute, and structured-edit mutation APIs with the unified getEditOperationContract(), preflightOperations(), and applyOperations() workflow.
* Added strict schema-backed preflight validation for public operations, including rejection of unsupported operations, unknown inputs, invalid values, and invalid rich-text or media payloads before changes are staged.
* Added the mwpsfe/get-public-operation-contract Ability so authorized integrations can retrieve the same handler-derived operation contract server-side without exposing internal attributes, selectors, bindings, or executor details.
* Added handler-derived current operation state for text, links, media, and block settings so integrations can preserve existing values without maintaining their own block-attribute mappings.
* Improved rich-text operation state to preserve supported inline link URL, target, and rel values.
* Added getListOperationContract() as the canonical definition of supported list operations and their required inputs, with list validation now derived from that contract.
* Public operation batches now stage through FrontEdit's shared editor executor and are recorded as a single undo-history step.
* Fixed public operation batches being rejected when a valid operation was a no-op because the requested value already matched the current value.
* Fixed table column alignment controls using stale shared alignment state instead of the active column's actual alignment.
* Removed justify as a text alignment option from the core/paragraph, core/heading, core/verse, and core/button block handlers.

= 1.1.5 =
* Fixed API operations not reliably storing a history entry to undo in the editor.

= 1.1.2 =
* Added WordPress 7.1 compatibility for Pullquote text alignment while retaining support for the legacy attribute format.
* Updated Abilities API metadata for WordPress 7.1 compatibility.
* Removed pagination parameters from core/icon media library.

= 1.1.0 =
* Added support for eligible Gutenberg custom post types whose editable content is stored in standard WordPress post content.
* Changed internal block UUID assignment to prepare only content that is opened or saved, avoiding automatic site-wide content scans.
* Fixed transient Gutenberg default paragraphs being assigned UUIDs.

= 1.0.19 =
* Replaced Base-only Pro preview screens with a practical Getting Started page and clarified the Gutenberg content and content-request boundaries.

= 1.0.18 =
* Added batch editing, previously a Pro feature, to the Base plugin, with independent undo history for each block during an editing session.

= 1.0.15 =
* Improved the schema-driven handler foundation with reusable optional-component placement and schema-declared heading/tag controls.
* Added a shipped custom-handler schema reference with frontend serialization compatibility requirements.

= 1.0.10 =
* Added support for WordPress Icon blocks.
* Opens the live editor immediately while post-lock verification continues safely in the background.

= 1.0.05 =
* Improved multi-element action-bar positioning for directly hovered nested and overlapping blocks.
* Fixed action bar hover transfer across overlapping blocks.
* Added authorized AI discovery for editable blocks and read-only block content, plus public live-page block enumeration for browser integrations.

= 1.0.02 =
* Added Base previews for the Pro Content Requests and Content Catalog admin screens.
* Added WordPress-native post locking for live editing, including an active-editor notice and optional takeover flow.

= 1.0.0 =
* Initial public 1.0.0 release for the WordPress plugin repository.

== Upgrade Notice ==

= 1.3.0 =
Public rich-text integrations must send anchor settings under formatAttributes[format].settings and use JSON booleans for new-tab and no-follow inputs. Trusted PHP integrations should use MWPSFE_Public_API instead of FrontEdit registries, handlers, permission services, or renderers.

= 1.2.0 =
Major Public API update. Integrations using the previous text, media, attribute, or structured-edit mutation APIs should migrate to getEditOperationContract(), preflightOperations(), and applyOperations(). List integrations can now use getListOperationContract().

= 1.1.5 =
Fixes API operations not reliably storing a history entry to undo in the editor.

= 1.1.2 =
Improves WordPress 7.1 compatibility, including updated Abilities API metadata and support for third-party icons registered through the new SVG Icon API

= 1.1.0 =
Adds eligible Gutenberg custom post type support and prepares internal block UUIDs only when content is opened or saved. Fixes a bug where transient Gutenberg default paragraphs were being assigned UUIDs.

= 1.0.19 =
Replaces Base-only Pro preview screens with a practical Getting Started page and clarifies the Gutenberg content and content-request boundaries.

= 1.0.18 =
Adds batch editing to the Base plugin.

= 1.0.15 =
Improves custom-handler schema capabilities and documents frontend serialization compatibility requirements.

= 1.0.10 =
Adds frontend editing support for WordPress Icon blocks. Makes the live editor open more quickly while retaining WordPress-native post-lock protection.

= 1.0.05 =
Improves action-bar positioning and adds secure editable-block discovery for AI and browser integrations.

= 1.0.02 =
Adds native WordPress post-lock protection for concurrent live editors and previews for the Pro content-request and catalog workflows.

= 1.0.0 =
FrontEdit 1.0.0 introduces the public repository release presentation for the plugin.
