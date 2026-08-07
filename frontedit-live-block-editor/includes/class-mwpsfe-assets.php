<?php
namespace MWPSFE;

use WP_Post;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_Assets {

	private static $instance;
	private $manager;
	private $permissions;
	private $handler_registry;
	private $uuid_manager;

	/**
	 * Get singleton instance of the Assets
	 * 
	 * This ensures only one instance of the Assets exists throughout the WordPress lifecycle.
	 * The instance is initialized on first call and cached for subsequent calls.
	 * 
	 * @return MWPSFE_Assets The singleton instance
	 */
	public static function instance() {
		if ( ! self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		$this->manager          = MWPSFE_Manager::instance();
		$this->permissions      = MWPSFE_Permissions::instance();
		$this->handler_registry = MWPSFE_Handler_Registry::instance();
		$this->uuid_manager     = MWPSFE_UUID_Manager::instance();
	}

	/**
	 * Build a plugin asset URL with the current plugin version appended.
	 *
	 * This keeps manually passed asset URLs, such as Shadow DOM stylesheet links,
	 * aligned with the same cache-busting version used by normal WordPress enqueues.
	 *
	 * @param string $relative_path Plugin-relative asset path.
	 * @return string
	 */
	private function get_versioned_asset_url( string $relative_path ): string {
		return add_query_arg( 'ver', MWPSFE_VERSION, MWPSFE_PLUGIN_URL . ltrim( $relative_path, '/' ) );
	}

	/**
	 * Initialize the Assets and register all hooks
	 * 
	 * This method sets up all WordPress hooks, filters, and initializes subsystems.
	 * It handles:
	 * - Frontend and admin asset enqueuing
	 * 
	 * Called automatically by instance() method.
	 * 
	 * @return void
	 */
	public function init() {
		add_action( 'enqueue_block_editor_assets', array( $this, 'enqueue_editor_assets' ) );
		add_action( 'wp_enqueue_scripts',          array( $this, 'enqueue_assets' ) );
		add_action( 'wp_enqueue_scripts',          array( $this, 'enqueue_schema_engine' ), 20 );
	}

	/**
	 * Enqueue assets for the Block Editor (Gutenberg admin interface)
	 * 
	 * This method loads JavaScript needed in the WordPress admin Block Editor to:
	 * - Display UUID indicators in the editor
	 * - Manage UUID persistence during editing
	 * - Provide visual feedback for editable blocks
	 * 
	 * It builds a map of supported blocks and their element type codes, plus the
	 * schema-declared pristine default block subset, then passes this data to
	 * JavaScript for client-side UUID management.
	 * 
	 * Runs only when WordPress loads the Gutenberg editor.
	 * 
	 * Enqueued script dependencies:
	 * - wp-blocks, wp-element, wp-editor (Gutenberg APIs)
	 * - wp-compose, wp-hooks, wp-data (WordPress utilities)
	 * 
	 * @return void
	 */
	public function enqueue_editor_assets() {
		global $post;
		$current_post_id = $post ? $post->ID : (int) filter_input( INPUT_GET, 'post', FILTER_SANITIZE_NUMBER_INT );

		// Build the supported map and schema-declared pristine default block subset.
		$supported_map           = array();
		$pristine_default_blocks = array();
		foreach ( $this->handler_registry->get_handlers() as $handler ) {
			if ( $handler->capability() === 'edit' ) {
				$blocks = $handler->get_supported_blocks();
				$code   = $handler->element_type_code(); 
				$schema_block_name             = '';
				$has_pristine_default_identity = false;

				if ( $handler instanceof MWPSFE_Schema_Handler_Interface ) {
					$schema                        = (array) $handler->get_schema_definition();
					$schema_block_name             = (string) ( $schema['block']['name'] ?? '' );
					$has_pristine_default_identity = is_string( $schema['identity']['pristineDefaultInnerHTML'] ?? null )
						&& '' !== $schema['identity']['pristineDefaultInnerHTML'];
				}
				if ( is_array( $blocks ) ) {
					foreach ( $blocks as $block_name ) {
						$supported_map[ $block_name ] = $code;
						if ( $has_pristine_default_identity && $block_name === $schema_block_name ) {
							$pristine_default_blocks[ $block_name ] = true;
						}
					}
				}
			}
		}

		// Enqueue external script
		wp_enqueue_script(
			'mwpsfe-block-editor-uuid',
			MWPSFE_PLUGIN_URL . 'assets/js/utils/block-editor-uuid.js',
			array( 'wp-blocks', 'wp-element', 'wp-editor', 'wp-compose', 'wp-hooks', 'wp-data' ),
			MWPSFE_VERSION,
			true
		);

		// Pass data to JavaScript
		wp_localize_script(
			'mwpsfe-block-editor-uuid',
			'mwpSfeEditorData',
			array(
				'supportedMap'          => $supported_map,
				'pristineDefaultBlocks' => $pristine_default_blocks,
				'currentPostId'         => $current_post_id
			)
		);
	}

	/**
	 * Enqueue frontend assets for inline editing.
	 *
	 * Orchestrates permission checks, dependency resolution, asset loading,
	 * and data localisation. All heavy lifting is delegated to helper methods.
	 *
	 * @return void
	 */
	public function enqueue_assets(): void {
		if ( ! $this->should_load_assets() ) return;

		global $post;

		$permissions          = $this->permissions->get_user_effective_permissions( get_current_user_id(), $post->ID );
		$filtered_handlers    = $this->get_permitted_handlers( $permissions );
		if ( empty( $filtered_handlers ) && ! $permissions['can_publish'] && ! $permissions['can_draft'] && ! $permissions['can_comment'] ) return;

		// This must happen before UUID-map localization and before the theme renders
		// the queried post's blocks later in the request.
		$this->uuid_manager->ensure_uuids_for_post( $post );

		$this->register_block_filters( $permissions );
		$this->enqueue_scripts( $permissions );
		$this->enqueue_styles( $post->ID, $permissions );
		$this->localize_data( $post, $permissions, $filtered_handlers );
	}

	/**
	 * Determine whether inline-edit assets should be loaded at all.
	 *
	 * @return bool
	 */
	private function should_load_assets(): bool {
		if ( is_admin() || ! is_singular() ) return false;

		global $post;

		if ( ! $post || ! is_user_logged_in() || ! MWPSFE_Post_Content_Support::is_supported_post( $post ) ) return false;

		$permissions = $this->permissions->get_user_effective_permissions( get_current_user_id(), $post->ID );

		return ! empty( $permissions['can_publish'] )
			|| ! empty( $permissions['can_draft'] )
			|| ! empty( $permissions['can_comment'] );
	}

	/**
	 * Return the subset of handlers the current user may access.
	 *
	 * @param array $permissions Result of get_user_effective_permissions().
	 * @return array
	 */
	private function get_permitted_handlers( array $permissions ): array {
		$can_edit    = $permissions['can_publish'] || $permissions['can_draft'];
		$can_comment = $permissions['can_comment'];

		return array_values(
			array_filter(
				$this->handler_registry->handlers_list(),
				static function ( array $handler ) use ( $can_edit, $can_comment ): bool {
					return ( $handler['capability'] === 'edit'    && $can_edit    )
						|| ( $handler['capability'] === 'comment' && $can_comment );
				}
			)
		);
	}

	/**
	 * Register Gutenberg block filters required for frontend inline editing.
	 *
	 * - Ensures core blocks are registered so wp.blocks.getBlockType() works.
	 * - Adds the mwpSfeUuid / mwpSfeUuidShadow attributes to every block type
	 *   so they survive createBlock() serialisation on the frontend.
	 *
	 * Only injected when the user can actually edit (not comment-only).
	 *
	 * @param array $permissions
	 * @return void
	 */
	private function register_block_filters( array $permissions ): void {
		if ( ! $permissions['can_publish'] && ! $permissions['can_draft'] ) return;

		wp_add_inline_script(
			'wp-block-library',
			'if ( window.wp && window.wp.blockLibrary && window.wp.blockLibrary.registerCoreBlocks ) {
				window.wp.blockLibrary.registerCoreBlocks();
			}',
			'after'
		);

		wp_add_inline_script(
			'wp-blocks',
			'if ( window.wp && window.wp.hooks ) {
				wp.hooks.addFilter(
					"blocks.registerBlockType",
					"mwpsfe/add-uuid-attribute-frontend",
					function( settings ) {
						settings.attributes = Object.assign( {}, settings.attributes, {
							mwpSfeUuid:       { type: "string", default: "" },
							mwpSfeUuidShadow: { type: "string", default: "" }
						});
						return settings;
					}
				);
			}',
			'after'
		);
	}

	/**
	 * Build the ordered dependency list for the main frontend script.
	 *
	 * Separates the static core deps from the optional block-editor deps so the
	 * graph stays explicit and easy to extend.
	 *
	 * @param bool $include_block_deps Whether to include wp-blocks / wp-block-library / wp-element.
	 * @return string[]
	 */
	private function build_frontend_script_deps( bool $include_block_deps ): array {
		$core_deps = array(
			'jquery',
			'wp-api-fetch',
			'mwpsfe-utils-public-api-bridge',
			'mwpsfe-utils-debounce',
			'mwpsfe-manager-move-floating-ui',
			'mwpsfe-utils-uuid',
			'mwpsfe-utils-url',
			'mwpsfe-utils-block-comparison',
			'mwpsfe-utils-block-serializer',
			'mwpsfe-utils-unsaved-changes',
			'mwpsfe-utils-api',
			'mwpsfe-manager-focus',
			'mwpsfe-manager-position',
			'mwpsfe-utils-element-state',
			'mwpsfe-utils-save-helpers',
			'mwpsfe-utils-lifecycle-helpers',
			'mwpsfe-manager-comment',
			'mwpsfe-manager-save',
			'mwpsfe-manager-batch-edit',
			'mwpsfe-utils-action-bar-dock',
			'mwpsfe-manager-post-lock',
			'mwpsfe-manager-hover',
			'mwpsfe-editor-lifecycle',
			'mwpsfe-editor-text',
			'mwpsfe-editor-media',
			'mwpsfe-utils-element-prep',
			'mwpsfe-utils-element-updater',
			'mwpsfe-utils-list-block-tracker',
			'mwpsfe-editor-rich-text',
			'mwpsfe-utils-action-bar',
			'mwpsfe-utils-mode-toggle-bar',
			'mwpsfe-manager-button',
			'mwpsfe-manager-overlay',
			'mwpsfe-utils-media-helper',
		);

		$block_deps = $include_block_deps
			? array( 'wp-blocks', 'wp-block-library', 'wp-element' )
			: array();

		return (array) apply_filters( 'mwpsfe_frontend_script_deps', array_merge( $core_deps, $block_deps ), $include_block_deps );
	}

	/**
	 * Register and enqueue all JavaScript assets.
	 *
	 * Scripts are listed in dependency order; each handle declares only its
	 * direct dependencies so WordPress can sort the load order itself.
	 *
	 * @param array $permissions
	 * @return void
	 */
	private function enqueue_scripts( array $permissions ): void {
		$can_edit   = $permissions['can_publish'] || $permissions['can_draft'];
		$block_deps = $can_edit ? array( 'wp-blocks', 'wp-block-library', 'wp-element' ) : array();
		$base_url   = MWPSFE_PLUGIN_URL;

		$scripts = array(
			// handle                                => array( path,                                           deps,                                                                                                                                                                                                                                                                                                         version        )
			'mwpsfe-utils-public-api-bridge'         => array( 'assets/js/utils/public-api-bridge.js',         array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-debounce'                  => array( 'assets/js/utils/debounce.js',                  array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-manager-move-floating-ui'        => array( 'assets/js/managers/FloatingUiMoveManager.js',  array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-url'                       => array( 'assets/js/utils/url-utils.js',                 array( 'mwpsfe-utils-debounce' ),                                                                                                                                                                                                                                                                             MWPSFE_VERSION ),
			'mwpsfe-utils-uuid'                      => array( 'assets/js/utils/uuid.js',                      array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-element-prep'              => array( 'assets/js/utils/element-prep.js',              array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-element-updater'           => array( 'assets/js/utils/element-updater.js',           array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-block-edit-session'        => array( 'assets/js/utils/block-edit-session.js',        array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-schema-editor-host'        => array( 'assets/js/utils/schema-editor-host.js',        array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-list-block-tracker'        => array( 'assets/js/utils/list-block-tracker.js',        array_merge( array( 'jquery', 'wp-api-fetch', 'mwpsfe-utils-element-prep' ), $block_deps ),                                                                                                                                                                                                                   MWPSFE_VERSION ),
			'mwpsfe-utils-schema-operation-executor' => array( 'assets/js/utils/schema-operation-executor.js', array( 'mwpsfe-utils-list-block-tracker' ),                                                                                                                                                                                                                                                                   MWPSFE_VERSION ),
			'mwpsfe-utils-api'                       => array( 'assets/js/utils/api.js',                       array( 'mwpsfe-utils-list-block-tracker' ),                                                                                                                                                                                                                                                                   MWPSFE_VERSION ),
			'mwpsfe-utils-block-comparison'          => array( 'assets/js/utils/block-comparison.js',          array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-block-serializer'          => array( 'assets/js/utils/block-serializer.js',          array( 'mwpsfe-utils-element-prep', 'mwpsfe-utils-list-block-tracker' ),                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-unsaved-changes'           => array( 'assets/js/utils/unsaved-changes.js',           array( 'mwpsfe-utils-block-comparison', 'mwpsfe-utils-block-serializer', 'mwpsfe-utils-schema-editor-host' ),                                                                                                                                                                                                 MWPSFE_VERSION ),
			'mwpsfe-utils-action-bar'                => array( 'assets/js/utils/action-bar.js',                array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-mode-toggle-bar'           => array( 'assets/js/utils/mode-toggle-bar.js',           array( 'mwpsfe-manager-move-floating-ui' ),                                                                                                                                                                                                                                                                   MWPSFE_VERSION ),
			'mwpsfe-utils-element-state'             => array( 'assets/js/utils/element-state.js',             array( 'mwpsfe-manager-overlay' ),                                                                                                                                                                                                                                                                            MWPSFE_VERSION ),
			'mwpsfe-utils-media-helper'              => array( 'assets/js/utils/media-helper.js',              array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-save-helpers'              => array( 'assets/js/utils/save-helpers.js',              array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-utils-lifecycle-helpers'         => array( 'assets/js/utils/lifecycle-helpers.js',         array( 'mwpsfe-manager-focus', 'mwpsfe-manager-position', 'mwpsfe-manager-overlay' ),                                                                                                                                                                                                                         MWPSFE_VERSION ),
			'mwpsfe-utils-action-bar-dock'           => array( 'assets/js/utils/action-bar-dock.js',           array( 'mwpsfe-manager-batch-edit' ),                                                                                                                                                                                                                                                                         MWPSFE_VERSION ),
			'mwpsfe-manager-position'                => array( 'assets/js/managers/PositionManager.js',        array( 'mwpsfe-utils-debounce' ),                                                                                                                                                                                                                                                                             MWPSFE_VERSION ),
			'mwpsfe-manager-button'                  => array( 'assets/js/managers/ButtonManager.js',          array( 'mwpsfe-manager-post-lock' ),                                                                                                                                                                                                                                                                          MWPSFE_VERSION ),
			'mwpsfe-manager-overlay'                 => array( 'assets/js/managers/OverlayManager.js',         array(),                                                                                                                                                                                                                                                                                                      MWPSFE_VERSION ),
			'mwpsfe-manager-focus'                   => array( 'assets/js/managers/FocusManager.js',           array( 'mwpsfe-manager-overlay' ),                                                                                                                                                                                                                                                                            MWPSFE_VERSION ),
			'mwpsfe-manager-comment'                 => array( 'assets/js/managers/CommentManager.js',         array( 'mwpsfe-utils-lifecycle-helpers', 'mwpsfe-manager-focus', 'mwpsfe-utils-element-state', 'mwpsfe-manager-overlay' ),                                                                                                                                                                                    MWPSFE_VERSION ),
			'mwpsfe-manager-save'                    => array( 'assets/js/managers/SaveManager.js',            array( 'mwpsfe-utils-api', 'mwpsfe-utils-block-serializer', 'mwpsfe-utils-element-state', 'mwpsfe-utils-list-block-tracker', 'mwpsfe-utils-element-prep', 'mwpsfe-utils-unsaved-changes', 'mwpsfe-utils-save-helpers', 'mwpsfe-manager-post-lock' ),                                                          MWPSFE_VERSION ),
			'mwpsfe-manager-batch-edit'              => array( 'assets/js/managers/BatchEditManager.js',       array( 'mwpsfe-utils-api', 'mwpsfe-utils-block-serializer', 'mwpsfe-utils-element-prep', 'mwpsfe-manager-post-lock' ),                                                                                                                                                                                        MWPSFE_VERSION ),
			'mwpsfe-manager-post-lock'               => array( 'assets/js/managers/PostLockManager.js',        array( 'mwpsfe-utils-api' ),                                                                                                                                                                                                                                                                                  MWPSFE_VERSION ),
			'mwpsfe-manager-hover'                   => array( 'assets/js/managers/HoverManager.js',           array( 'mwpsfe-utils-element-state', 'mwpsfe-utils-uuid', 'mwpsfe-manager-overlay', 'mwpsfe-manager-comment' ),                                                                                                                                                                                               MWPSFE_VERSION ),
			'mwpsfe-editor-lifecycle'                => array( 'assets/js/editors/EditorLifecycle.js',         array( 'mwpsfe-utils-lifecycle-helpers', 'mwpsfe-manager-focus', 'mwpsfe-manager-position', 'mwpsfe-utils-element-state', 'mwpsfe-manager-overlay', 'mwpsfe-manager-hover', 'mwpsfe-utils-element-prep' ),                                                                                                    MWPSFE_VERSION ),
			'mwpsfe-editor-rich-text'                => array( 'assets/js/editors/MWPEditor.js',               array( 'mwpsfe-utils-schema-operation-executor', 'mwpsfe-utils-block-edit-session', 'mwpsfe-utils-schema-editor-host', 'mwpsfe-manager-move-floating-ui' ),                                                                                                                                                   MWPSFE_VERSION ),
			'mwpsfe-manager-toolbar'                 => array( 'assets/js/managers/ToolbarManager.js',         array( 'mwpsfe-editor-rich-text' ),                                                                                                                                                                                                                                                                           MWPSFE_VERSION ),
			'mwpsfe-editor-text'                     => array( 'assets/js/editors/TextEditor.js',              array( 'mwpsfe-utils-lifecycle-helpers', 'mwpsfe-manager-focus', 'mwpsfe-manager-position', 'mwpsfe-utils-api', 'mwpsfe-utils-element-state', 'mwpsfe-manager-overlay', 'mwpsfe-editor-rich-text', 'mwpsfe-manager-toolbar', 'mwpsfe-manager-save', 'mwpsfe-editor-lifecycle', 'mwpsfe-utils-element-prep' ), MWPSFE_VERSION ),
			'mwpsfe-editor-media'                    => array( 'assets/js/editors/MediaEditor.js',             array( 'mwpsfe-utils-lifecycle-helpers', 'mwpsfe-manager-focus', 'mwpsfe-manager-position', 'mwpsfe-utils-api', 'mwpsfe-manager-overlay', 'mwpsfe-utils-media-helper', 'mwpsfe-utils-block-edit-session', 'mwpsfe-utils-schema-editor-host', 'mwpsfe-manager-save', 'mwpsfe-manager-toolbar' ),               MWPSFE_VERSION ),
			'mwpsfe-frontend'                        => array( 'assets/js/frontend-inline-edit.js',            $this->build_frontend_script_deps( $can_edit ),                                                                                                                                                                                                                                                               MWPSFE_VERSION ),
		);

		if ( $this->should_load_abe_launcher( get_queried_object_id(), $permissions ) ) {
			$scripts['mwpsfe-utils-abe-launcher'] = array( 'assets/js/utils/abe-launcher.js', array( 'mwpsfe-frontend' ), MWPSFE_VERSION );
		}

		foreach ( $scripts as $handle => $script_data ) {
			list( $path, $deps, $version ) = $script_data;
			wp_enqueue_script( $handle, $base_url . $path, $deps, $version, true );
		}
	}

	/**
	 * Enqueue CSS assets and fonts.
	 *
	 * @param int   $post_id     Current post ID.
	 * @param array $permissions Current user's effective permissions.
	 * @return void
	 */
	private function enqueue_styles( int $post_id, array $permissions ): void {
		wp_enqueue_style(
			'mwpsfe-inline-style',
			MWPSFE_PLUGIN_URL . 'assets/css/frontend-inline.css',
			array(),
			MWPSFE_VERSION
		);

		if ( ! $this->should_load_abe_launcher( $post_id, $permissions ) ) {
			return;
		}

		wp_enqueue_style(
			'mwpsfe-abe-ui-style',
			MWPSFE_PLUGIN_URL . 'assets/css/frontend-abe-ui.css',
			array( 'mwpsfe-inline-style' ),
			MWPSFE_VERSION
		);

	}

	/**
	 * Inject the MWPSFE_Manager_Data global used by the unchanged frontend script.
	 *
	 * @param \WP_Post $post
	 * @param array    $permissions
	 * @param array    $filtered_handlers
	 * @return void
	 */
	private function localize_data( \WP_Post $post, array $permissions, array $filtered_handlers ): void {
		$data = array(
			'restBase'          => esc_url_raw( rest_url() ),
			'restUrl'           => esc_url_raw( rest_url( MWPSFE_REST_NAMESPACE ) ),
			'mediaLibraryUrl'   => esc_url_raw( rest_url( 'wp/v2/media' ) ),
			'iconLibraryUrl'    => esc_url_raw( rest_url( 'wp/v2/icons' ) ),
			'postId'            => $post->ID,
			'nonce'             => wp_create_nonce( 'wp_rest' ),
			'handlers'          => $filtered_handlers,
			'permissions'       => $permissions,
			'uuidMap'           => $this->build_uuid_map_lite( $post->ID ),
			'pageRevisionToken' => $this->manager->get_post_revision_token( $post->ID ),
			'hasPro'            => (bool) apply_filters( 'mwpsfe_has_pro_frontend_modules', false ),
			'canManageDrafts'   => (bool) apply_filters( 'mwpsfe_frontend_can_manage_drafts', current_user_can( 'manage_options' ) && ! empty( $permissions['can_publish'] ), (int) $post->ID, $permissions ),
			'abeLauncher'       => $this->build_abe_launcher_config( $post->ID, $permissions ),
		);

		// Inject before the shared frontend dependency chain so every runtime module
		// receives the same localized state.
		wp_add_inline_script(
			'mwpsfe-utils-uuid',
			'window.MWPSFE_Manager_Data = ' . wp_json_encode( $data ) . ';',
			'before'
		);
	}

	/**
	 * Build the localized ABE launcher configuration used by the base frontend bridge.
	 *
	 * The base plugin always owns the bottom-right launcher. When the ABE add-on is
	 * inactive, the launcher opens a download modal; when the add-on is active, the
	 * filter below marks it as available and supplies the live bridge config.
	 *
	 * @param int   $post_id     Post ID.
	 * @param array $permissions Current user's effective permissions.
	 * @return array
	 */
	private function build_abe_launcher_config( int $post_id, array $permissions ): array {
		$launcher_enabled = $this->should_load_abe_launcher( $post_id, $permissions );
		$can_use_live_abe = $this->current_user_can_launch_abe( $post_id, $permissions );

		$config = array(
			'enabled'             => $launcher_enabled,
			'canUseLive'          => $can_use_live_abe,
			'isAvailable'         => false,
			'eventName'           => 'mwp-abe-launch-request',
			'label'               => 'ABE',
			'downloadUrl'         => 'https://maintainwp.com',
			'waitlistUrl'         => 'https://maintainwp.com/abe-waitlist-signup-page/',
			'unavailableTitle'    => 'AI Assisted Block Editor Coming Soon',
			'unavailableSubtitle' => 'Sign up for updates.',
			'unavailableMessage'  => 'AI Automated Block Editor is coming soon. Join our waitlist to get early updates, sneak peeks, and be among the first to know when the plugin officially launches. We will let you know as soon as it is available.',
			'unavailableCta'      => 'Join the Waitlist',
			'styleUrls'           => array(
				$this->get_versioned_asset_url( 'assets/css/frontend-inline.css' ),
				$this->get_versioned_asset_url( 'assets/css/frontend-abe-ui.css' ),
			),
		);

		return (array) apply_filters( 'mwpsfe_abe_launcher_config', $config, $post_id, $permissions );
	}

	/**
	 * Return whether the shared ABE launcher should load for this request.
	 *
	 * @param int   $post_id     Current post ID.
	 * @param array $permissions Current user's effective permissions.
	 * @return bool
	 */
	private function should_load_abe_launcher( int $post_id, array $permissions ): bool {
		$should_load = ! empty( $permissions['can_publish'] ) || ! empty( $permissions['can_draft'] );

		return (bool) apply_filters( 'mwpsfe_should_load_abe_launcher', $should_load, $post_id, $permissions );
	}

	/**
	 * Return whether the current user may open the live ABE workflow.
	 *
	 * This hook lets the ABE add-on reuse the same edit-access decision that the
	 * base launcher config exposes, rather than duplicating a separate policy.
	 *
	 * @param int   $post_id     Current post ID.
	 * @param array $permissions Current user's effective permissions.
	 * @return bool
	 */
	private function current_user_can_launch_abe( int $post_id, array $permissions ): bool {
		$can_launch = ! empty( $permissions['can_publish'] ) || ! empty( $permissions['can_draft'] );

		return (bool) apply_filters( 'mwpsfe_user_can_launch_abe', $can_launch, $post_id, $permissions );
	}

	/**
	 * Build a lightweight UUID -> handler map for the frontend.
	 *
	 * The full cached map stores complete block data; we trim it down to only
	 * what the JS layer needs: handler associations and block name. Pro may add
	 * its pending-draft metadata through the filter at the return boundary.
	 *
	 * @param int $post_id
	 * @return array<string, array{handlers: mixed, blockName: string}>
	 */
	private function build_uuid_map_lite( int $post_id ): array {
		$uuid_map_lite = array();

		foreach ( $this->uuid_manager->get_cached_uuid_map( $post_id ) as $uuid => $data ) {
			$uuid_map_lite[ $uuid ] = array(
				'handlers'  => $data['handlers'],
				'blockName' => $data['blockName'],
			);
		}

		return apply_filters( 'mwpsfe_frontend_uuid_map', $uuid_map_lite, $post_id );
	}

	/**
	 * Enqueue schema runtime and localize schema definitions for schema-enabled handlers.
	 *
	 * @return void
	 */
	public function enqueue_schema_engine(): void {
		if ( is_admin() ) return;
		if ( ! wp_script_is( 'mwpsfe-frontend', 'enqueued' ) ) return;

		$schemas = $this->collect_schema_definitions();
		if ( empty( $schemas ) ) return;

		wp_enqueue_script(
			'mwpsfe-schema-engine',
			MWPSFE_PLUGIN_URL . 'assets/js/schema/schema-engine.js',
			array( 'mwpsfe-frontend', 'mwpsfe-utils-element-prep', 'mwpsfe-utils-block-serializer' ),
			MWPSFE_VERSION,
			true
		);

		wp_add_inline_script(
			'mwpsfe-schema-engine',
			'window.MWPSFE_Schema_Data = ' . wp_json_encode(
				array(
					'version' => 1,
					'schemas' => $schemas,
				)
			) . ';',
			'before'
		);

		wp_enqueue_script(
			'mwpsfe-public-api',
			MWPSFE_PLUGIN_URL . 'assets/js/public-api.js',
			array( 'mwpsfe-schema-engine', 'mwpsfe-utils-public-api-bridge', 'mwpsfe-utils-schema-editor-host', 'mwpsfe-utils-schema-operation-executor' ),
			MWPSFE_VERSION,
			true
		);
	}

	/**
	 * Collect normalized schema maps for all registered schema-enabled edit handlers.
	 *
	 * @return array<string,array>
	 */
	private function collect_schema_definitions(): array {
		$schema_map = array();

		foreach ( $this->handler_registry->get_handlers() as $handler ) {
			if (
				! ( $handler instanceof MWPSFE_Handler_Interface )
				|| $handler->capability() !== 'edit'
				|| ! ( $handler instanceof MWPSFE_Schema_Handler_Interface )
			) {
				continue;
			}

			$schema = (array) $handler->get_schema_definition();
			if (
				empty( $schema['version'] )
				|| empty( $schema['block']['name'] )
				|| empty( $schema['block']['type'] )
				|| empty( $schema['components'] )
			) {
				continue;
			}

			$schema_map[ $handler->id() ] = $schema;
		}

		return $schema_map;
	}
}
