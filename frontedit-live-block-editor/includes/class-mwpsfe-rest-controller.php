<?php
namespace MWPSFE;

use WP_Post;
use WP_Query;
use WP_REST_Request;
use WP_REST_Response;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_REST_Controller {

	private static $instance;
	private $manager;
	private $permissions;
	private $content_requests;
	private $handler_registry;
	private $uuid_manager;
	private $operations_service;
	private $post_lock_service;

	/**
	 * Get singleton instance of the REST Controller
	 * 
	 * This ensures only one instance of the REST Controller exists throughout the WordPress lifecycle.
	 * The instance is initialized on first call and cached for subsequent calls.
	 * 
	 * @return MWPSFE_REST_Controller The singleton instance
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
		$this->content_requests = MWPSFE_Content_Requests::instance();
		$this->handler_registry = MWPSFE_Handler_Registry::instance();
		$this->uuid_manager     = MWPSFE_UUID_Manager::instance();
		$this->operations_service = MWPSFE_Operations_Service::instance();
		$this->post_lock_service  = MWPSFE_Post_Lock_Service::instance();
	}

	/**
	 * Initialize the REST Controller and register all hooks
	 * 
	 * This method sets up all WordPress hooks, filters, and initializes subsystems.
	 * It handles:
	 * - REST API route registration
	 * 
	 * Called automatically by instance() method.
	 * 
	 * @return void
	 */
	public function init() {
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
	}

	/**
	 * Register REST API routes for the plugin
	 * 
	 * Registers the following endpoints:
	 * 
	 * GET /mwpsfe/v1/handlers
	 *   - Public endpoint listing all available handlers
	 *   - Used by frontend to discover editing capabilities
	 * 
	 * POST /mwpsfe/v1/preview
	 *   - Preview changes before applying (edit handlers only)
	 *   - Requires: can_publish OR can_draft permission
	 *   - Returns: before/after HTML comparison
	 * 
	 * POST /mwpsfe/v1/apply
	 *   - Apply edit changes to a block
	 *   - Requires: can_publish OR can_draft permission
	 *   - Saves to database and history
	 * 
	 * POST /mwpsfe/v1/comment
	 *   - Submit a comment/request for an element
	 *   - Requires: can_comment permission
	 *   - Creates content request for admin review
	 * 
	 * POST /mwpsfe/v1/get-block-html
	 *   - Get rendered HTML for a specific block
	 *   - Requires: can_publish OR can_draft permission
	 * 
	 * POST /mwpsfe/v1/get-block-state
	 *   - Get complete block state (structure + HTML)
	 *   - Requires: can_publish OR can_draft permission
	 * 
	 * POST /mwpsfe/v1/get-media-library
	 *   - Get media library items (images, audio, video, files)
	 *   - Requires: can_publish OR can_draft plus upload_files
	 *
	 * POST /mwpsfe/v1/resolve-media-attributes
	 *   - Resolve attachment data for schema-driven media saves
	 *   - Requires: can_publish OR can_draft plus upload_files
	 * 
	 * @return void
	 */
	public function register_rest_routes() {
		$namespace = MWPSFE_REST_NAMESPACE;

		register_rest_route( $namespace, '/handlers', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'rest_list_handlers' ),
			'permission_callback' => '__return_true'
		) );

		register_rest_route( $namespace, '/preview', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'rest_preview' ),
			'permission_callback' => array( $this->permissions, 'check_rest_edit_permission' )
		) );

		register_rest_route( $namespace, '/apply', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'rest_apply' ),
			'permission_callback' => array( $this->permissions, 'check_rest_publish_permission' )
		) );

		register_rest_route( $namespace, '/post-lock/claim', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'rest_claim_post_lock' ),
			'permission_callback' => array( $this->permissions, 'check_rest_edit_permission' )
		) );

		register_rest_route( $namespace, '/comment', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'rest_comment' ),
			'permission_callback' => array( $this->permissions, 'check_rest_comment_permission' )
		) );

		register_rest_route( $namespace, '/get-block-html', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'rest_get_block_html' ),
			'permission_callback' => array( $this->permissions, 'check_rest_edit_permission' )
		) );

		register_rest_route( $namespace, '/get-block-state', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'rest_get_block_state' ),
			'permission_callback' => array( $this->permissions, 'check_rest_edit_permission' )
		) );

		register_rest_route( $namespace, '/get-page-block-tree', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'rest_get_page_block_tree' ),
			'permission_callback' => array( $this->permissions, 'check_rest_batch_tree_permission' ),
		) );

		register_rest_route( $namespace, '/apply-batch', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'rest_apply_batch' ),
			'permission_callback' => array( $this->permissions, 'check_rest_batch_apply_permission' ),
		) );

		register_rest_route( $namespace, '/get-media-library', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'rest_get_media_library' ),
			'permission_callback' => array( $this->permissions, 'check_rest_media_permission' )
		) );

		register_rest_route( $namespace, '/resolve-media-attributes', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'rest_resolve_media_attributes' ),
			'permission_callback' => array( $this->permissions, 'check_rest_resolve_media_permission' )
		) );

	}

	/**
	 * Claim, refresh, or explicitly take over the native WordPress post lock.
	 *
	 * @param WP_REST_Request $request Request containing post_id and take_over.
	 * @return WP_REST_Response
	 */
	public function rest_claim_post_lock( $request ) {
		$payload = $this->post_lock_service->claim_lock(
			(int) $request->get_param( 'post_id' ),
			(bool) $request->get_param( 'take_over' )
		);

		if ( isset( $payload['error'] ) ) {
			return new WP_REST_Response( $payload, (int) ( $payload['status'] ?? 400 ) );
		}

		return rest_ensure_response( $payload );
	}

	/**
	 * REST endpoint handler: List all available handlers
	 * 
	 * Returns the complete list of registered handlers formatted for frontend consumption.
	 * This is a public endpoint that doesn't require authentication.
	 * 
	 * @param WP_REST_Request $request The REST request object
	 * @return WP_REST_Response Response containing handlers array
	 */
	public function rest_list_handlers( $request ) {
		return rest_ensure_response( array( 'handlers' => $this->handler_registry->handlers_list() ) );
	}

	/**
	 * REST endpoint handler: Preview edit changes
	 * 
	 * This endpoint generates a preview of what the content will look like after
	 * applying an edit content, without actually saving to the database.
	 * 
	 * Process:
	 * 1. Validates post and handler exist
	 * 2. Verifies handler has 'edit' capability
	 * 3. Retrieves target block (from cache or parse)
	 * 4. Calls handler's generate_preview method
	 * 5. Returns before/after HTML for comparison
	 * 
	 * Used by frontend to show users a preview before confirming changes.
	 * 
	 * Required parameters:
	 * - post_id: The post ID
	 * - element_uuid: The block UUID to preview
	 * - handler_id: The handler to use
	 * - edit_content: The edited content
	 * 
	 * @param WP_REST_Request $request The REST request object
	 * @return WP_REST_Response Response with original/before/after HTML or error
	 */
	public function rest_preview( $request ) {
		$payload = $this->operations_service->preview_block_edit(
			(int) $request->get_param( 'post_id' ),
			sanitize_text_field( $request->get_param( 'element_uuid' ) ),
			sanitize_text_field( $request->get_param( 'handler_id' ) ),
			$request->get_param( 'edit_content' )
		);

		if ( isset( $payload['error'] ) ) {
			return new WP_REST_Response( array( 'error' => $payload['error'], 'lock' => $payload['lock'] ?? null ), (int) ( $payload['status'] ?? 400 ) );
		}

		return rest_ensure_response( $payload );
	}

	/**
	 * REST endpoint handler: Apply edit changes
	 * 
	 * This endpoint applies an edit to a block and saves it to the database.
	 * This is the main "save edit" endpoint.
	 * 
	 * Process:
	 * 1. Validates post and handler exist
	 * 2. Verifies handler has 'edit' capability
	 * 3. Delegates to handler's apply_edit method
	 * 4. Handler updates block, saves to database, and records history
	 * 5. Returns success/error status
	 * 
	 * The handler is responsible for:
	 * - Applying provided content
	 * - Updating the block structure
	 * - Saving to database
	 * - Recording in history
	 * 
	 * Required parameters:
	 * - post_id: The post ID
	 * - element_uuid: The block UUID to edit
	 * - handler_id: The handler to use
	 * - edit_content: The edited content
	 * 
	 * @param WP_REST_Request $request The REST request object
	 * @return WP_REST_Response Response with success status or error
	 */
	public function rest_apply( $request ) {
		$post_id      = (int) $request->get_param('post_id');
		$handler_id   = sanitize_text_field( (string) $request->get_param('handler_id') );
		$element_uuid = sanitize_text_field( (string) $request->get_param('element_uuid') );
		$edit_content = $request->get_param('edit_content');

		$override = apply_filters( 'mwpsfe_rest_apply_override', null, $request, $this );
		if ( null !== $override ) {
			return rest_ensure_response( $override );
		}

		$payload = $this->operations_service->apply_block_edit(
			$post_id,
			$element_uuid,
			$handler_id,
			$edit_content,
			(int) $request->get_param( 'page_revision_token' )
		);

		if ( isset( $payload['error'] ) ) {
			return new WP_REST_Response( array( 'error' => $payload['error'] ), (int) ( $payload['status'] ?? 400 ) );
		}

		return rest_ensure_response( $payload );
	}

	/**
	 * Return the full editable block state used by a Base batch-edit session.
	 *
	 * @param WP_REST_Request $request REST request containing post_id.
	 * @return WP_REST_Response Batch state or an error response.
	 */
	public function rest_get_page_block_tree( WP_REST_Request $request ): WP_REST_Response {
		$payload = $this->operations_service->get_page_block_tree( (int) $request->get_param( 'post_id' ) );
		if ( isset( $payload['error'] ) ) {
			return new WP_REST_Response( array( 'error' => $payload['error'] ), (int) ( $payload['status'] ?? 400 ) );
		}

		return rest_ensure_response( $payload );
	}

	/**
	 * Apply a published batch edit through the shared Base save pipeline.
	 *
	 * @param WP_REST_Request $request REST request containing post_id, changes,
	 *                                and an optional page revision token.
	 * @return WP_REST_Response Batch save result or an error response.
	 */
	public function rest_apply_batch( WP_REST_Request $request ): WP_REST_Response {
		$payload = $this->operations_service->apply_batch_edits(
			(int) $request->get_param( 'post_id' ),
			$request->get_param( 'changes' ),
			(int) $request->get_param( 'page_revision_token' )
		);

		if ( isset( $payload['error'] ) ) {
			return new WP_REST_Response(
				array(
					'error'            => $payload['error'],
					'lock'             => $payload['lock'] ?? null,
					'conflicted_uuids' => $payload['conflicted_uuids'] ?? null,
				),
				(int) ( $payload['status'] ?? 400 )
			);
		}

		return rest_ensure_response( $payload );
	}

	/**
	 * REST endpoint handler: Submit a comment/content request
	 * 
	 * This endpoint handles comment submissions from users who can't directly edit.
	 * It creates a content request that administrators can review and approve.
	 * 
	 * Process:
	 * 1. Validates handler exists and has 'comment' capability
	 * 2. Retrieves handler's element_type for proper categorization
	 * 3. Creates a content request via the MWPSFE_Content_Requests system
	 * 4. Returns success with request ID
	 * 
	 * Content requests are stored separately and can be reviewed in the admin area.
	 * This enables collaborative content workflows where non-editors can suggest changes.
	 * 
	 * Required parameters:
	 * - post_id: The post ID
	 * - element_uuid: The block UUID being commented on
	 * - handler_id: The comment handler ID
	 * - comment: The comment/suggestion text
	 * - element_text: The current element text (for context)
	 * 
	 * @param WP_REST_Request $request The REST request object
	 * @return WP_REST_Response Response with request_id and success flag or error
	 */
	public function rest_comment( $request ) {
		$post_id      = (int) $request->get_param('post_id');
		$handler_id   = sanitize_text_field( $request->get_param('handler_id') );
		$element_uuid = sanitize_text_field( $request->get_param('element_uuid') );
		$comment      = sanitize_textarea_field( $request->get_param('comment') );
		$element_text = sanitize_text_field( $request->get_param('element_text') );

		$handler = $this->handler_registry->get_handler( $handler_id );

		if ( ! $handler || $handler->capability() !== 'comment' ) {
			return new WP_REST_Response( array( 'error' => 'Comment handler not found' ), 400 );
		}

		// Get handler element type for content request
		$element_type = $handler->element_type();

		// Look up the live block and capture it as serialized markup so the admin
		// UI can render an accurate preview of the element that was commented on.
		$element_serialized = '';
		$post               = get_post( $post_id );
		if ( $post ) {
			$blocks = parse_blocks( $post->post_content );
			$block  = MWPSFE_Block_Utils::find_block_by_uuid( $blocks, $element_uuid );
			if ( $block ) {
				$element_serialized = serialize_blocks( array( $block ) );
			}
		}

		// Use the content requests system
		$request_obj = $this->content_requests->create_request( $post_id, $element_uuid, $handler_id, $comment, $element_text, $element_type, $element_serialized );
		
		if ( ! $request_obj ) {
			return new WP_REST_Response( array( 'error' => 'Failed to create request' ), 500 );
		}

		return rest_ensure_response( array( 
			'request_id' => $request_obj['id'],
			'success'    => true 
		) );
	}

	/**
	 * REST endpoint handler: Get rendered HTML for a block
	 * 
	 * This endpoint retrieves the rendered HTML output for a specific block.
	 * Used by the frontend when it needs to refresh the display of a block
	 * after an edit or to get the current state.
	 * 
	 * Process:
	 * 1. Retrieves post by ID
	 * 2. Looks up block in cached UUID map (fast path)
	 * 3. Falls back to parsing if cache miss (slow path)
	 * 4. Renders block using WordPress render_block function
	 * 5. Returns rendered HTML
	 * 
	 * The rendered HTML includes all WordPress filters and theme styling,
	 * making it ready for direct insertion into the DOM.
	 * 
	 * Required parameters:
	 * - post_id: The post ID
	 * - element_uuid: The block UUID to render
	 * 
	 * @param WP_REST_Request $request The REST request object
	 * @return WP_REST_Response Response with rendered HTML or error
	 */
	public function rest_get_block_html( $request ) {
		$post_id         = (int) $request->get_param('post_id');
		$element_uuid    = sanitize_text_field( $request->get_param('element_uuid') );
		$element_uuids   = $request->get_param('element_uuids');
		$requested_uuids = array();

		if ( is_array( $element_uuids ) ) {
			foreach ( $element_uuids as $uuid ) {
				$uuid = sanitize_text_field( $uuid );
				if ( '' !== $uuid ) {
					$requested_uuids[] = $uuid;
				}
			}
		}

		if ( '' !== $element_uuid ) {
			$requested_uuids[] = $element_uuid;
		}

		$requested_uuids = array_values( array_unique( $requested_uuids ) );

		$payload = $this->manager->get_block_html_payload( $post_id, $requested_uuids );
		if ( isset( $payload['error'] ) ) {
			return new WP_REST_Response( array( 'error' => $payload['error'] ), (int) ( $payload['status'] ?? 400 ) );
		}

		return rest_ensure_response( $payload );
	}

	/**
	 * REST endpoint: Get complete block state for frontend editing
	 * 
	 * This endpoint returns all information needed by the frontend to enable
	 * inline editing of a specific block. Returns:
	 * - Block attributes (text alignment, level, etc.)
	 * - Block structure (blockName, innerHTML, innerBlocks)
	 * - Rendered HTML (for preview/display)
	 * 
	 * Used primarily for list editing where the full block structure is needed.
	 * 
	 * Route: POST /mwpsfe/v1/get-block-state
	 * 
	 * @param WP_REST_Request $request Request object with post_id and element_uuid
	 * @return WP_REST_Response Response with block state or error
	 */
	public function rest_get_block_state( $request ) {
		$payload = $this->operations_service->get_block_state(
			(int) $request->get_param( 'post_id' ),
			sanitize_text_field( $request->get_param( 'element_uuid' ) )
		);

		if ( isset( $payload['error'] ) ) {
			return new WP_REST_Response( array( 'error' => $payload['error'] ), (int) ( $payload['status'] ?? 400 ) );
		}

		return rest_ensure_response( $payload );
	}
	
	/**
	 * REST endpoint handler: Get media library items
	 * 
	 * This endpoint provides paginated access to the WordPress media library,
	 * filtered by media type. Used by the frontend media picker/browser.
	 * 
	 * Supports filtering by:
	 * - 'image': Image files only
	 * - 'audio': Audio files only
	 * - 'video': Video files only
	 * - 'file': All attachment types
	 * 
	 * Returns items sorted by date (newest first) with:
	 * - id: Attachment ID
	 * - url: Full-size media URL
	 * - title: Media title
	 * - thumb: Thumbnail URL (for images)
	 * - type: MIME type
	 * 
	 * Pagination parameters:
	 * - page: Page number (default 1)
	 * - per_page: Items per page (default 20)
	 * 
	 * Response includes pagination metadata:
	 * - total: Total number of items
	 * - total_pages: Total number of pages
	 * - page: Current page
	 * - per_page: Items per page
	 * 
	 * @param WP_REST_Request $request The REST request object
	 * @return WP_REST_Response Response with items array and pagination data
	 */
	public function rest_get_media_library( $request ) {
		return rest_ensure_response(
			$this->operations_service->get_media_library(
				(int) $request->get_param( 'page' ) ?: 1,
				(int) $request->get_param( 'per_page' ) ?: 20,
				sanitize_text_field( $request->get_param( 'media_type' ) )
			)
		);
	}

	/**
	 * REST endpoint handler: Resolve attachment attributes for schema-driven media saves.
	 *
	 * Resolves the canonical attachment URL/dimensions for the requested size slug
	 * using WordPress image APIs so the schema runtime can preserve block-level
	 * intent (for example `sizeSlug: "thumbnail"`) when a different attachment is
	 * selected on the frontend.
	 *
	 * For image attachments with a non-empty size slug, this prefers
	 * `image_downsize()` so user-configured default sizes and custom
	 * `add_image_size()` registrations are both respected. Non-image attachments or
	 * image fallbacks return the original attachment URL with metadata dimensions when
	 * available.
	 *
	 * @param WP_REST_Request $request The REST request object.
	 * @return WP_REST_Response Response containing resolved attachment attributes.
	 */
	public function rest_resolve_media_attributes( WP_REST_Request $request ): WP_REST_Response {
		$payload = $this->operations_service->resolve_media_attributes(
			(int) $request->get_param( 'attachment_id' ),
			sanitize_key( (string) $request->get_param( 'size_slug' ) )
		);

		if ( isset( $payload['error'] ) ) {
			return new WP_REST_Response( array( 'error' => $payload['error'] ), (int) ( $payload['status'] ?? 400 ) );
		}

		return rest_ensure_response( $payload );
	}
}
