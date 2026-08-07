<?php
namespace MWPSFE;

use WP_Post;
use WP_REST_Request;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_UUID_Manager {

	private static $instance;
	private $handler_registry;
	public static $current_rest_post_id = null;

	/**
	 * Get singleton instance of the UUID Manager
	 * 
	 * This ensures only one instance of the UUID Manager exists throughout the WordPress lifecycle.
	 * The instance is initialized on first call and cached for subsequent calls.
	 * 
	 * @return MWPSFE_UUID_Manager The singleton instance
	 */
	public static function instance() {
		if ( ! self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}
	
	private function __construct() {
		$this->handler_registry = MWPSFE_Handler_Registry::instance();
	}

	/**
	 * Initialize the UUID Manager and register all hooks
	 * 
	 * This method sets up all WordPress hooks, filters, and initializes subsystems.
	 * It handles:
	 * - UUID system initialization and persistence
	 * 
	 * Called automatically by instance() method.
	 * 
	 * @return void
	 */
	public function init() {
		// UUID Persistence: Register attribute for ALL blocks
		add_filter( 'register_block_type_args', array( $this, 'register_uuid_attribute' ), 20, 2 );

		// UUID Persistence: Inject into HTML on frontend render
		add_filter( 'render_block', array( $this, 'render_uuid_into_html' ), 10, 2 );

		// UUID Persistence: Ensure UUIDs exist before saving to DB
		add_filter( 'rest_pre_insert_post', array( $this, 'force_uuids_before_save' ), 10, 2 );
		add_filter( 'wp_insert_post_data',  array( $this, 'force_uuids_before_standard_save' ), 10, 2 );

		// Cache Invalidation
		add_action( 'save_post', array( $this, 'on_save_post_invalidate_cache' ), 10, 3 );
		add_action( 'save_post', array( $this, 'prepare_uuids_after_post_save' ), 11, 3 );

		// Prepare one eligible post before the block editor reads its saved content.
		add_action( 'admin_init', array( $this, 'maybe_prepare_opened_block_editor_post' ) );
	}

	/**
	 * Prepare UUIDs for the eligible post being opened in the block editor.
	 *
	 * The hook runs before WordPress loads the edit screen's post content. This
	 * keeps UUID assignment strictly post-scoped and prevents plugin activation
	 * or updates from scanning unrelated site content.
	 *
	 * @return void
	 */
	public function maybe_prepare_opened_block_editor_post(): void {
		global $pagenow;

		if ( 'post.php' !== $pagenow || wp_doing_ajax() ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Core's post.php edit-screen navigation request has no nonce; this value is sanitized and authorization is enforced below before any write.
		$post_id = isset( $_GET['post'] ) ? absint( wp_unslash( $_GET['post'] ) ) : 0;
		$post    = get_post( $post_id );

		if (
			! $post instanceof WP_Post
			|| ! MWPSFE_Post_Content_Support::is_supported_post( $post )
			|| ! current_user_can( 'edit_post', $post_id )
		) {
			return;
		}

		$this->ensure_uuids_for_post( $post );
	}

	/**
	 * Prepare UUIDs after WordPress has saved one eligible post.
	 *
	 * New posts do not have a persistent ID while wp_insert_post_data runs.
	 * Assigning identifiers there would produce invalid IDs, while this hook
	 * runs immediately after WordPress gives the post its permanent ID. The
	 * direct post-content write in ensure_uuids_for_post() deliberately avoids
	 * recursively firing save_post again.
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Saved post.
	 * @param bool    $update  Whether the post already existed.
	 * @return void
	 */
	public function prepare_uuids_after_post_save( int $post_id, WP_Post $post, bool $update ): void {
		if (
			wp_is_post_revision( $post_id )
			|| wp_is_post_autosave( $post_id )
			|| ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE )
			|| ! MWPSFE_Post_Content_Support::is_supported_post( $post )
		) {
			return;
		}

		$this->ensure_uuids_for_post( $post );
	}

	/**
	 * Ensure every FrontEdit-editable block in one eligible post has a healthy UUID,
	 * except schema-declared pristine default writing surfaces that have never been
	 * assigned an identity.
	 *
	 * This intentionally writes only the post that a permitted user has opened.
	 * It preserves the existing serialized-block content path while avoiding a
	 * site-wide activation or update scan.
	 *
	 * @param WP_Post $post Eligible post whose post_content is being prepared.
	 * @return bool Whether persisted post_content changed.
	 */
	public function ensure_uuids_for_post( WP_Post $post ): bool {
		if ( ! MWPSFE_Post_Content_Support::is_supported_post( $post ) || '' === $post->post_content ) {
			return false;
		}

		$blocks     = parse_blocks( $post->post_content );
		$modified   = false;
		$seen_uuids = array();

		$this->process_blocks_for_uuid( $blocks, $post->ID, $modified, $seen_uuids );

		if ( ! $modified ) {
			return false;
		}

		$serialized_content = serialize_blocks( $blocks );
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- UUID preparation updates only the post that the current user opened and avoids recursive save hooks; caches are cleared immediately after.
		$updated = $wpdb->update(
			$wpdb->posts,
			array( 'post_content' => $serialized_content ),
			array( 'ID' => $post->ID )
		);

		if ( false === $updated ) {
			throw new \RuntimeException( 'FrontEdit could not prepare block IDs for the requested post.' );
		}

		// Keep the already-resolved queried post synchronized for the first frontend render.
		$post->post_content = $serialized_content;
		$this->invalidate_post_uuid_cache( $post->ID );
		clean_post_cache( $post->ID );

		return true;
	}

	/**
	 * Determine whether a block reads one or more values from an external source.
	 *
	 * FrontEdit's generic block serializer updates block attributes. It must not
	 * expose a block whose displayed value is controlled by WordPress block
	 * bindings, because writing the serialized attribute would not update the
	 * authoritative external value.
	 *
	 * @param array $block Parsed block.
	 * @return bool Whether the block contains WordPress metadata bindings.
	 */
	public function has_external_block_bindings( array $block ): bool {
		$bindings = $block['attrs']['metadata']['bindings'] ?? array();

		return is_array( $bindings ) && ! empty( $bindings );
	}

	/**
	 * Register mwpSfeUuid attribute for ALL blocks
	 * 
	 * This filter hook runs during block type registration and adds two custom attributes
	 * to every block type in WordPress:
	 * - mwpSfeUuid: The primary UUID for the block
	 * - mwpSfeUuidShadow: A backup UUID for self-healing if the primary is corrupted
	 * 
	 * This ensures Gutenberg preserves these attributes even when added server-side,
	 * preventing the block editor from stripping them out.
	 * 
	 * @param array $args Block type registration arguments
	 * @param string $name Block type name (e.g., 'core/paragraph')
	 * @return array Modified arguments with UUID attributes added
	 */
	public function register_uuid_attribute( $args, $name ) {
		if ( ! isset( $args['attributes'] ) ) {
			$args['attributes'] = array();
		}
		
		// Add attribute if not exists
		if ( ! isset( $args['attributes']['mwpSfeUuid'] ) ) {
			$args['attributes']['mwpSfeUuid'] = array(
				'type'    => 'string',
				'default' => '',
			);
		}

		// Also add shadow attribute for self-healing
		if ( ! isset( $args['attributes']['mwpSfeUuidShadow'] ) ) {
			$args['attributes']['mwpSfeUuidShadow'] = array(
				'type'    => 'string',
				'default' => '',
			);
		}
		
		return $args;
	}

	/**
	 * Inject data-mwp-sfe-uuid into HTML based on block attribute
	 * 
	 * This filter runs on frontend render and adds the UUID as a data attribute
	 * to the block's root HTML element. This allows the frontend JavaScript to
	 * identify and track blocks for inline editing.
	 * 
	 * Security considerations:
	 * - Only injects UUIDs for users who can edit the post
	 * - Validates post ID from block context or global state
	 * - Safely injects into first HTML tag using regex
	 * 
	 * @param string $block_content The rendered block HTML
	 * @param array $block The block array with attributes
	 * @return string Modified HTML with data-mwp-sfe-uuid attribute injected
	 */
	public function render_uuid_into_html( $block_content, $block ) {
		if ( ! is_array( $block ) || $this->has_external_block_bindings( $block ) ) {
			return $block_content;
		}

		// Exit immediately if the block has no UUID
		if ( empty( $block['attrs']['mwpSfeUuid'] ) ) {
			return $block_content;
		}

		// Never inject data-mwp-sfe-uuid in admin context (catalog, emails, REST admin
		// requests). The attribute is only meaningful for frontend inline editing.
		if ( is_admin() ) {
			return $block_content;
		}

		// Identify the Post ID from block context (most reliable) or global state
		$post_id = null;
		if ( ! empty( $block['attrs']['postId'] ) ) {
			$post_id = $block['attrs']['postId'];
		} elseif ( self::$current_rest_post_id ) {
			// fallback for REST API rendering
			$post_id = self::$current_rest_post_id;
		} else {
			$post_id = get_queried_object_id();
		}

		// Security: Only show UUIDs to users who can actually edit this post
		if (
			! $post_id
			|| ! MWPSFE_Post_Content_Support::is_supported_post_id( (int) $post_id )
			|| ! current_user_can( 'edit_post', $post_id )
		) {
			return $block_content;
		}

		// Inject data-mwp-sfe-uuid
		$uuid = esc_attr( $block['attrs']['mwpSfeUuid'] );
		$block_content = preg_replace( 
			'/<([a-z0-9]+)([^>]*)>/i', 
			'<$1 data-mwp-sfe-uuid="' . $uuid . '"$2>',
			$block_content, 
			1 
		);
		
		return $block_content;
	}

	/**
	 * REST API Hook: Ensure UUIDs before saving via Block Editor
	 * 
	 * This hook runs before the REST API saves post content from Gutenberg.
	 * It ensures all editable blocks have UUIDs before the content reaches the database.
	 * 
	 * This is critical because:
	 * - Gutenberg may create new blocks without UUIDs
	 * - Copy/paste operations can duplicate UUIDs
	 * - Import operations may have invalid UUIDs
	 * 
	 * The method parses blocks, assigns/fixes UUIDs, and updates the post content.
	 * 
	 * @param WP_Post $prepared_post The post object being prepared for database
	 * @param WP_REST_Request $request The REST request object
	 * @return WP_Post Modified post object with UUID-validated content
	 */
	public function force_uuids_before_save( $prepared_post, $request ) {
		// Skip UUID processing for autosaves.
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return $prepared_post;
		}

		if ( $prepared_post instanceof WP_Post && MWPSFE_Post_Content_Support::is_supported_post( $prepared_post ) && ! empty( $prepared_post->post_content ) ) {
			$blocks = parse_blocks( $prepared_post->post_content );
			$modified = false;
			$post_id = $prepared_post->ID;
			
			// Initialize UUID tracker for this save operation
			$seen_uuids = array();
			
			// Traverse and assign UUIDs
			$this->process_blocks_for_uuid( $blocks, $post_id, $modified, $seen_uuids );
			
			if ( $modified ) {
				$prepared_post->post_content = serialize_blocks( $blocks );
			}
		}
		return $prepared_post;
	}

	/**
	 * Standard Save Hook: Ensure UUIDs before saving to DB via generic methods
	 * 
	 * This hook runs before standard WordPress save operations (Classic Editor,
	 * Quick Edit, programmatic saves, etc.) It serves the same purpose as
	 * force_uuids_before_save but for non-REST API saves.
	 * 
	 * Skips processing for:
	 * - Auto-drafts (temporary editor states)
	 * - Attachments (post_status = 'inherit')
	 * - Empty content
	 * 
	 * @param array $data The post data being saved (sanitized and slashed)
	 * @param array $postarr The raw post data array
	 * @return array Modified post data with UUID-validated content
	 */
	public function force_uuids_before_standard_save( $data, $postarr ) {
		if ( $data['post_status'] === 'auto-draft' || $data['post_status'] === 'inherit' ) {
			return $data;
		}

		// Skip if WordPress has signalled we're in an autosave
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return $data;
		}

		if ( empty( $data['post_content'] ) ) {
			return $data;
		}

		$post_id = (int) ( $postarr['ID'] ?? 0 );
		$post_type = (string) ( $data['post_type'] ?? $postarr['post_type'] ?? '' );
		if ( ! MWPSFE_Post_Content_Support::is_supported_post_type( $post_type ) ) {
			return $data;
		}

		// A new post receives its permanent ID after this filter. UUID
		// preparation is therefore handled by prepare_uuids_after_post_save().
		if ( $post_id < 1 ) {
			return $data;
		}

		if ( ! MWPSFE_Post_Content_Support::is_supported_post_id( $post_id ) ) {
			return $data;
		}

		$content  = wp_unslash( $data['post_content'] );
		$blocks   = parse_blocks( $content );
		$modified = false;
		
		// Initialize UUID tracker for this save operation
		$seen_uuids = array();
		
		$this->process_blocks_for_uuid( $blocks, $post_id, $modified, $seen_uuids );
		
		if ( $modified ) {
			$data['post_content'] = wp_slash( serialize_blocks( $blocks ) );
		}
		
		return $data;
	}

	/**
	 * Return true when a block is a nested core/list that must never own a UUID.
	 *
	 * The canonical list ownership rule is: only the outermost core/list owns
	 * the persisted plugin UUID for the entire list tree. Nested core/list
	 * blocks are structural children of that same logical element. Relaxing this
	 * rule in only one layer is dangerous because editor healing, frontend
	 * binding, history, and list serialization all assume one UUID-owning root.
	 *
	 * @param array  $block             Parsed block.
	 * @param string $parent_block_name Direct parent block name.
	 * @return bool
	 */
	private function is_non_owning_nested_list_block( array $block, string $parent_block_name = '' ): bool {
		return ( $block['blockName'] ?? '' ) === 'core/list' && 'core/list-item' === $parent_block_name;
	}

	/**
	 * Remove persisted UUID attrs from a non-owning nested list block.
	 *
	 * This is a defensive cleanup pass. Nested list UUIDs should never exist,
	 * but if editor-state healing or historical content introduced them, we must
	 * strip them before save/serialization so one logical list cannot fracture
	 * into multiple separately tracked/history-owned elements.
	 *
	 * @param array &$block Parsed block, modified in place.
	 * @return bool         True when attrs were removed.
	 */
	private function sanitize_non_owning_nested_list_uuid_attrs( array &$block ): bool {
		$modified = false;

		if ( ! isset( $block['attrs'] ) || ! is_array( $block['attrs'] ) ) {
			return false;
		}

		foreach ( array( 'mwpSfeUuid', 'mwpSfeUuidShadow' ) as $key ) {
			if ( array_key_exists( $key, $block['attrs'] ) ) {
				unset( $block['attrs'][ $key ] );
				$modified = true;
			}
		}

		return $modified;
	}

	/**
	 * Recursive function to walk block tree and ensure UUIDs
	 * 
	 * This is the core UUID assignment and validation logic. It recursively processes
	 * all blocks in a post and:
	 * 
	 * 1. UUID Assignment: Generates UUIDs for blocks that don't have them, except
	 *    schema-declared pristine default writing surfaces that have never had one
	 * 2. Duplicate Detection: Finds and regenerates duplicate UUIDs
	 * 3. Structural Validation: Ensures UUIDs match post ID and element type
	 * 4. Self-Healing: Restores UUIDs from shadow attribute if corrupted
	 * 5. Shadow Sync: Keeps shadow attribute in sync with primary UUID
	 * 6. History Initialization: Creates version 1 history for new UUIDs
	 * 7. Nested List Handling: Skips UUID assignment for nested lists
	 * 
	 * The method only assigns UUIDs to blocks that have registered edit handlers.
	 * 
	 * @param array &$blocks Array of block arrays (passed by reference, will be modified)
	 * @param int $post_id The post ID these blocks belong to
	 * @param bool &$modified Flag tracking if any modifications were made (passed by reference)
	 * @param array &$seen_uuids Tracker for duplicate detection (passed by reference)
	 * @param string $parent_block_name The parent block name (for nested list detection)
	 * @return void
	 */
	private function process_blocks_for_uuid( &$blocks, $post_id, &$modified, &$seen_uuids, $parent_block_name = '' ) {
		foreach ( $blocks as &$block ) {
			if ( empty( $block['blockName'] ) ) continue;

			if ( $this->has_external_block_bindings( $block ) ) {
				if ( ! empty( $block['innerBlocks'] ) ) {
					$this->process_blocks_for_uuid( $block['innerBlocks'], $post_id, $modified, $seen_uuids, $block['blockName'] );
				}
				continue;
			}

			// Canonical list ownership rule: only the outermost core/list may own
			// a persisted plugin UUID. Nested core/list blocks are structural
			// descendants of that same logical list and must be sanitized if stale
			// UUID attrs ever reach PHP. Do not "fix" this locally without keeping
			// the editor healer and list serializer in sync.
			if ( $this->is_non_owning_nested_list_block( $block, $parent_block_name ) ) {
				if ( $this->sanitize_non_owning_nested_list_uuid_attrs( $block ) ) {
					$modified = true;
				}

				// This is a nested list - skip UUID processing but still process its children
				if ( ! empty( $block['innerBlocks'] ) ) {
					$this->process_blocks_for_uuid( $block['innerBlocks'], $post_id, $modified, $seen_uuids, $block['blockName'] );
				}
				continue; // Don't assign UUID to nested lists
			}

			$handler = null;
			foreach ( $this->handler_registry->get_handlers() as $h ) {
				if ( $h->capability() === 'edit' && $h->can_handle_block( $block ) ) {
					$handler = $h;
					break;
				}
			}
			
			if ( $handler ) {
				$existing_uuid      = $block['attrs']['mwpSfeUuid'] ?? '';
				$shadow_uuid        = $block['attrs']['mwpSfeUuidShadow'] ?? ''; // Shadow check
				$element_type_code  = $handler->element_type_code();

				// --- SELF HEALING START ---
				// If the ID is missing but the Shadow exists, heal it from Shadow
				if ( empty( $existing_uuid ) && ! empty( $shadow_uuid ) ) {
					$existing_uuid = $shadow_uuid;
					$block['attrs']['mwpSfeUuid'] = $existing_uuid;
					$modified = true;
				}

				// Structural Integrity Check: Does it match the PostID and ElementType?
				$is_corrupt = false;
				if ( ! empty( $existing_uuid ) ) {
					$required_prefix = $post_id . '-' . $element_type_code . '-';
					if ( strpos( $existing_uuid, $required_prefix ) !== 0 ) {
						$is_corrupt = true; // It's from a different post or wrong type
					}
				}
				// --- SELF HEALING END ---

				// DUPLICATE DETECTION + INTEGRITY HEALING
				if ( ! empty( $existing_uuid ) && ( isset( $seen_uuids[ $existing_uuid ] ) || $is_corrupt ) ) {
					$new_uuid = $this->generate_element_uuid( $post_id, $element_type_code );
					$block['attrs']['mwpSfeUuid'] = $new_uuid;
					$block['attrs']['mwpSfeUuidShadow'] = $new_uuid; // Update shadow
					$seen_uuids[ $new_uuid ] = true;
					$modified = true;

					/**
					 * Fires when a UUID is assigned (or re-assigned) to a block.
					 * Pro catalog hooks here to create an initial history entry.
					 *
					 * @param int    $post_id    The post ID.
					 * @param string $new_uuid   The newly assigned UUID.
					 * @param array  $block      The block array.
					 * @param string $handler_id The handler ID that owns this block.
					 */
					do_action( 'mwpsfe_uuid_assigned', $post_id, $new_uuid, $block, $handler->id() );
				} elseif ( empty( $existing_uuid ) && ! $this->is_uuidless_pristine_default_block( $block, $handler ) ) {
					// No UUID at all, generate new one
					$uuid = $this->ensure_block_uuid( $block, $post_id, $handler );
					if ( $uuid ) {
						$block['attrs']['mwpSfeUuidShadow'] = $uuid; // Set shadow
						$seen_uuids[ $uuid ] = true;
						$modified = true;

						/** @see mwpsfe_uuid_assigned */
						do_action( 'mwpsfe_uuid_assigned', $post_id, $uuid, $block, $handler->id() );
					}
				} else {
					// UUID exists and is unique, just track it
					$seen_uuids[ $existing_uuid ] = true;
					// Ensure shadow is always present even on healthy blocks
					if ( $shadow_uuid !== $existing_uuid ) {
						$block['attrs']['mwpSfeUuidShadow'] = $existing_uuid;
						$modified = true;
					}

					/**
					 * Fired for every UUID that already exists and is healthy.
					 * Pro catalog uses this to ensure a version-1 history record
					 * exists for blocks that pre-date the plugin installation.
					 *
					 * @see mwpsfe_uuid_assigned
					 */
					do_action( 'mwpsfe_uuid_assigned', $post_id, $existing_uuid, $block, $handler->id() );
				}
			}

			// Recurse into inner blocks
			if ( ! empty( $block['innerBlocks'] ) ) {
				$this->process_blocks_for_uuid( $block['innerBlocks'], $post_id, $modified, $seen_uuids, $block['blockName'] );
			}
		}
	}

	/**
	 * Return whether one block is a schema-declared, never-identified Gutenberg
	 * default writing surface.
	 *
	 * This exemption is intentionally narrower than "an empty paragraph": it
	 * requires both UUID attrs to be absent, no non-identity block attrs, no
	 * inner blocks, and the exact native serialized markup declared by the
	 * handler schema. A block that ever received an identity does not match and
	 * continues through the normal healing, duplicate detection, and history
	 * initialization paths even after its author deletes its text.
	 *
	 * @param array                    $block   Parsed Gutenberg block.
	 * @param MWPSFE_Handler_Interface $handler Edit handler that owns the block.
	 * @return bool True only for a pristine, UUID-less default block.
	 */
	private function is_uuidless_pristine_default_block( array $block, MWPSFE_Handler_Interface $handler ): bool {
		if ( ! ( $handler instanceof MWPSFE_Schema_Handler_Interface ) ) {
			return false;
		}

		$schema                      = (array) $handler->get_schema_definition();
		$schema_block_name           = (string) ( $schema['block']['name'] ?? '' );
		$pristine_default_inner_html = $schema['identity']['pristineDefaultInnerHTML'] ?? null;

		if (
			! is_string( $pristine_default_inner_html )
			|| '' === $pristine_default_inner_html
			|| $schema_block_name !== ( $block['blockName'] ?? '' )
			|| ! empty( $block['innerBlocks'] )
			|| trim( (string) ( $block['innerHTML'] ?? '' ) ) !== $pristine_default_inner_html
		) {
			return false;
		}

		$attrs = isset( $block['attrs'] ) && is_array( $block['attrs'] ) ? $block['attrs'] : array();
		foreach ( $attrs as $key => $value ) {
			if ( in_array( $key, array( 'mwpSfeUuid', 'mwpSfeUuidShadow' ), true ) && '' === (string) $value ) {
				continue;
			}

			return false;
		}

		return true;
	}

	/**
	 * Generates UUID if missing, otherwise returns existing
	 * 
	 * This method follows an immutability principle: if a UUID already exists,
	 * it is NEVER changed (unless detected as duplicate/corrupted elsewhere).
	 * This ensures UUIDs remain stable across saves.
	 * 
	 * If a UUID needs to be generated:
	 * - Uses handler's element_type_code for proper namespacing
	 * - Ensures attribute array exists before setting
	 * - Returns the generated UUID for tracking
	 * 
	 * @param array &$block The block array (passed by reference, may be modified)
	 * @param int $post_id The post ID this block belongs to
	 * @param MWPSFE_Handler_Interface $handler The handler for this block type
	 * @return string|null The UUID (existing or newly generated) or null if invalid block
	 */
	public function ensure_block_uuid( &$block, $post_id, $handler ) {
		if ( empty( $block['blockName'] ) ) {
			return null;
		}
		
		// IMMUTABLE CHECK: If it exists, keep it.
		if ( isset( $block['attrs']['mwpSfeUuid'] ) && ! empty( $block['attrs']['mwpSfeUuid'] ) ) {
			return $block['attrs']['mwpSfeUuid'];
		}
		
		// GENERATE NEW: Only if missing.
		$element_type_code = $handler->element_type_code();
		$uuid              = $this->generate_element_uuid( $post_id, $element_type_code );
		
		if ( ! isset( $block['attrs'] ) ) {
			$block['attrs'] = array();
		}
		$block['attrs']['mwpSfeUuid'] = $uuid;
		
		return $uuid;
	}

	/**
	 * Generate a unique UUID for a block element
	 * 
	 * UUID format: {post_id}-{element_type_code}-{random_16_chars}
	 * Example: 123-paragraph-a8Kj9mPq2xLn4Wrt
	 * 
	 * This format enables:
	 * - Post-level uniqueness (post_id prefix)
	 * - Element type identification (element_type_code)
	 * - Collision prevention (16 random alphanumeric chars = 62^16 combinations)
	 * 
	 * @param int $post_id The post ID
	 * @param string $element_type_code The element type code (e.g., 'paragraph', 'heading')
	 * @return string The generated UUID
	 */
	public function generate_element_uuid( $post_id, $element_type_code ) {
		$chars  = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
		$random = '';
		for ( $i = 0; $i < 16; $i++ ) {
			$random .= $chars[ wp_rand( 0, 61 ) ];
		}
		return $post_id . '-' . $element_type_code . '-' . $random;
	}

	/**
	 * Invalidate all post caches
	 * 
	 * This method performs a bulk cache invalidation across all published eligible posts.
	 * It should be called when settings change that affect handler behavior or UUID processing.
	 * 
	 * Clears:
	 * - UUID map caches (both transient and object cache)
	 * - UUID processed markers
	 * - WordPress object cache
	 * 
	 * This is an expensive operation and should only be called when absolutely necessary,
	 * such as after plugin settings updates or handler registration changes.
	 * 
	 * @return void
	 */
	public function invalidate_all_post_caches() {
		$post_types = MWPSFE_Post_Content_Support::get_supported_post_types();
		if ( empty( $post_types ) ) {
			return;
		}

		$post_ids = get_posts(
			array(
				'post_type'              => $post_types,
				'post_status'            => 'publish',
				'posts_per_page'         => -1,
				'fields'                 => 'ids',
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			)
		);

		foreach ( $post_ids as $post_id ) {
			$this->invalidate_post_uuid_cache( (int) $post_id );
		}

		wp_cache_flush();
	}

	/**
	 * Invalidate UUID map and processed flags on post save
	 * 
	 * This hook fires whenever a post is saved and ensures caches are cleared
	 * so the next request will rebuild fresh UUID maps with the latest content.
	 * 
	 * Skips:
	 * - Post revisions (not actual content saves)
	 * - Autosaves (temporary draft states)
	 * 
	 * Clears for the specific post:
	 * - UUID map (transient and object cache)
	 * - Processed markers
	 * 
	 * Hooked to: save_post action
	 * 
	 * @param int $post_id The post ID being saved
	 * @param WP_Post $post The post object
	 * @param bool $update Whether this is an update (true) or new post (false)
	 * @return void
	 */
	public function on_save_post_invalidate_cache( $post_id, $post, $update ) {
		// Skip autosaves and revisions
		if ( wp_is_post_revision( $post_id ) || ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) ) {
			return;
		}

		if ( ! MWPSFE_Post_Content_Support::is_supported_post( $post ) ) {
			return;
		}

		$this->invalidate_post_uuid_cache( (int) $post_id );
	}

	/**
	 * Clear cached UUID data for one post without invoking a broad cache flush.
	 *
	 * @param int $post_id Post ID whose UUID cache should be cleared.
	 * @return void
	 */
	private function invalidate_post_uuid_cache( int $post_id ): void {

		// Remove persistent map/transient/object cache to force rebuild next time
		delete_transient( 'mwpsfe_uuid_map_trans_' . $post_id );
		wp_cache_delete( 'mwpsfe_uuid_map_' . $post_id, 'mwpsfe' );

		// Remove processed markers so next request will rebuild/mark properly
		delete_transient( 'mwpsfe_uuid_processed_' . $post_id );
		wp_cache_delete( 'mwpsfe_uuid_processed_' . $post_id, 'mwpsfe' );
		delete_post_meta( $post_id, 'mwpsfe_uuid_processed' );
	}
	
	/**
	 * Build and cache the UUID map for a post
	 * 
	 * This method builds a complete map of all editable elements in a post,
	 * associating each UUID with its content, handlers, and block data.
	 * 
	 * IMPORTANT: This method is READ-ONLY - it never modifies the database.
	 * It only parses existing content and caches the results.
	 * 
	 * The built map is cached for 12 hours in both:
	 * - Object cache (fast, in-memory)
	 * - Transient (persistent, database)
	 * 
	 * This enables fast frontend rendering without reparsing blocks on every request.
	 * 
	 * @param int $post_id The post ID to build map for
	 * @return array UUID map with structure: uuid => ['text', 'handlers', 'blockName', 'source', 'block']
	 */
	private function build_uuid_map( $post_id ) {
		$post = get_post( $post_id );
		if ( ! MWPSFE_Post_Content_Support::is_supported_post( $post ) ) return array();

		// Parse Blocks
		$blocks = parse_blocks( $post->post_content );

		// Collect UUIDs (don't create new ones)
		$uuid_map = array();
		$this->collect_all_element_uuids( $blocks, $uuid_map );

		// Cache the map for 12 hours
		wp_cache_set( 'mwpsfe_uuid_map_' . $post_id, $uuid_map, 'mwpsfe', 12 * HOUR_IN_SECONDS );
		set_transient( 'mwpsfe_uuid_map_trans_' . $post_id, $uuid_map, 12 * HOUR_IN_SECONDS );

		return $uuid_map;
	}
	
	/**
	 * Get cached UUID map for post (object cache -> transient -> build)
	 * 
	 * This method implements a two-tier caching strategy:
	 * 1. Object cache (fastest, in-memory, lasts request or until cache cleared)
	 * 2. Transient (fast, database, persists 12 hours)
	 * 3. Build fresh (slowest, parses all blocks)
	 * 
	 * The first successful lookup populates the faster caches for subsequent requests.
	 * This minimizes database queries and block parsing operations.
	 * 
	 * Cache hierarchy:
	 * - Request 1: Builds map, saves to transient + object cache
	 * - Request 2: Loads from object cache (if still in memory)
	 * - Request 3 (after cache flush): Loads from transient, populates object cache
	 * - Request 4 (after 12 hours): Rebuilds, saves to both caches
	 * 
	 * @param int $post_id The post ID
	 * @return array The UUID map (from cache or freshly built)
	 */
	public function get_cached_uuid_map( $post_id ) {
		if ( ! MWPSFE_Post_Content_Support::is_supported_post_id( (int) $post_id ) ) {
			return array();
		}

		// Try Object Cache (Fastest - Memory)
		$cached = wp_cache_get( 'mwpsfe_uuid_map_' . $post_id, 'mwpsfe' );
		if ( $cached !== false ) return $cached;

		// Try Transient (Fast - DB)
		$trans = get_transient( 'mwpsfe_uuid_map_trans_' . $post_id );
		if ( $trans !== false ) {
			// Refill object cache
			wp_cache_set( 'mwpsfe_uuid_map_' . $post_id, $trans, 'mwpsfe', HOUR_IN_SECONDS );
			return $trans;
		}

		// Not found? Build it (and save to DB if needed)
		return $this->build_uuid_map( $post_id );
	}

	/**
	 * Recursively collect UUIDs from blocks that have handlers
	 * 
	 * This method builds a map of all editable elements in a post, associating each UUID
	 * with its text content, available handlers, and block information. The map is used
	 * by the frontend to enable inline editing.
	 * 
	 * @param array $blocks Array of block arrays to process
	 * @param array &$uuid_map Map to populate (passed by reference)
	 * @param string $parent_block_name Direct parent block name (for nested list detection)
	 * @return void
	 */
	public function collect_all_element_uuids( $blocks, &$uuid_map, $parent_block_name = '' ) {
		foreach ( $blocks as $block ) {
			if ( empty( $block['blockName'] ) ) continue;

			if ( $this->has_external_block_bindings( $block ) ) {
				if ( ! empty( $block['innerBlocks'] ) ) {
					$this->collect_all_element_uuids( $block['innerBlocks'], $uuid_map, $block['blockName'] );
				}
				continue;
			}
			
			// Mirror the canonical list ownership rule used during UUID
			// assignment. Even if historical content somehow still contains stale
			// nested-list UUID attrs, never expose those descendants as separate
			// editable elements on the frontend.
			if ( $this->is_non_owning_nested_list_block( $block, $parent_block_name ) ) {
				if ( ! empty( $block['innerBlocks'] ) ) {
					$this->collect_all_element_uuids( $block['innerBlocks'], $uuid_map, $block['blockName'] );
				}
				continue;
			}

			$handler_ids  = array();
			$content_type = 'text'; // Default
			$handler      = null;
			
			foreach ( $this->handler_registry->get_handlers() as $h ) {
				if ( $h->capability() === 'edit' && $h->can_handle_block( $block ) ) {
					$handler_ids[] = $h->id();

					$comment_handler = $h->get_comment_handler();
					if (
						$comment_handler instanceof MWPSFE_Handler_Interface &&
						$comment_handler->capability() === 'comment'
					) {
						$handler_ids[] = $comment_handler->id();
					}

					$content_type = $h->content_type(); // Use handler's content type
					$handler      = $h; // Keep reference to core handler
				}
			}

			$handler_ids = array_values( array_unique( $handler_ids ) );

			if ( ! empty( $handler_ids ) && $handler ) {
				if ( isset( $block['attrs']['mwpSfeUuid'] ) ) {
					$uuid = $block['attrs']['mwpSfeUuid'];
					$text = '';

					// For blocks that declare a block-attribute URL key, read the URL
					// directly from the parsed block attrs so inner blocks can never
					// contribute their own URLs to this block's preview text.
					$block_url_attr = $handler->get_block_url_attr();
					if ( $block_url_attr !== null && ! empty( $block['attrs'][ $block_url_attr ] ) ) {
						$url  = $block['attrs'][ $block_url_attr ];
						$text = basename( (string) wp_parse_url( $url, PHP_URL_PATH ) );
					}

					// Original extraction path - used when attrs didn't provide a URL
					// (e.g. old blocks, plain media blocks with no stored URL attr).
					if ( ! $text ) {
						if ( $content_type === 'media' ) {
							// Media blocks always have their URL in their own innerHTML. 
							// Using render_block here pulls in inner blocks, causing regex to match nested images.
							$text = $handler->extract_content_from_html( $block['innerHTML'] ?? '' );
						} else {
							// Derive preview text from the parsed block itself, not the rendered
							// page DOM. This keeps catalog previews aligned with schema-defined
							// editable components and avoids rendered wrappers/adjacent content
							// influencing the extracted text.
							$text = $handler->extract_content_from_html( serialize_blocks( array( $block ) ) );
						}
					}
					
					$uuid_map[ $uuid ] = array(
						'text'      => $text,
						'handlers'  => $handler_ids,
						'blockName' => $block['blockName'],
						'source'    => 'gutenberg',
						'block'     => $block,
					);
				}
			}
			
			if ( ! empty( $block['innerBlocks'] ) ) {
				$this->collect_all_element_uuids( $block['innerBlocks'], $uuid_map, $block['blockName'] );
			}
		}
	}
}
