<?php
namespace MWPSFE;

use WP_Post;
use WP_Query;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_Manager {

	private static $instance;
	private $content_requests;
	private $handler_registry;
	private $uuid_manager;
	public static $suppress_history_auto_record = false;

	/**
	 * Get singleton instance of the Manager
	 * 
	 * This ensures only one instance of the Manager exists throughout the WordPress lifecycle.
	 * The instance is initialized on first call and cached for subsequent calls.
	 * 
	 * @return MWPSFE_Manager The singleton instance
	 */
	public static function instance() {
		if ( ! self::$instance ) {
			self::$instance = new self();
			self::$instance->init();
		}
		return self::$instance;
	}

	/**
	 * Initialize the Manager and register all hooks
	 * 
	 * This method sets up all WordPress hooks, filters, and initializes subsystems.
	 * It handles:
	 * - UUID system initialization and persistence
	 * - REST API route registration
	 * - Frontend and admin asset enqueuing
	 * - Handler registration via filter system
	 * - Integration with admin interface, rich text editor, and content requests
	 * - Pro catalog initialization if enabled
	 * 
	 * Called automatically by instance() method.
	 * 
	 * @return void
	 */
	public function init() {
		add_action( 'set_transient',      array( self::class, 'fix_transient_autoload' ) );
		add_action( 'before_delete_post', array( $this, 'on_before_delete_post' ) );

		// Initialize core subsystems
		MWPSFE_Admin::instance()->init();
		MWPSFE_Permissions::instance()->init();
		MWPSFE_Assets::instance()->init();
		MWPSFE_REST_Controller::instance()->init();
		MWPSFE_Abilities::instance()->init();
		MWPSFE_Rich_Text_Editor::instance()->init();

		// Initialize subsystems and store references
		$this->content_requests = MWPSFE_Content_Requests::instance();
		$this->handler_registry = MWPSFE_Handler_Registry::instance();
		$this->uuid_manager     = MWPSFE_UUID_Manager::instance();

		$this->content_requests->init();
		$this->handler_registry->init();
		$this->uuid_manager->init();

		// Register block renderer hooks
		MWPSFE_Block_Renderer::register_hooks();

		/**
		 * Fires after the Manager has registered all of its own hooks and handlers.
		 *
		 * Pro classes (Catalog, Content Requests ticket system, etc.) use this
		 *
		 * @param MWPSFE_Manager $manager The fully-initialized Manager instance.
		 */
		do_action( 'mwpsfe_manager_init', $this );
	}

	/**
	 * Ensure a plugin transient is stored with autoload = 'no'.
	 *
	 * Hooked to 'set_transient', which fires after every successful
	 * set_transient() call. Only acts on our plugin's transients (prefixed
	 * 'mwpsfe_'), leaving all other transients untouched.
	 *
	 * @param string $transient Transient name (no '_transient_' prefix).
	 */
	public static function fix_transient_autoload( string $transient ): void {
		$transient = sanitize_key( $transient );

		if ( strpos( $transient, 'mwpsfe_' ) !== 0 ) {
			return;
		}

		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- No WordPress API exists for updating the autoload column; this is a scoped write to this plugin's own transient value row, so object caching is not applicable.
		$wpdb->update(
			$wpdb->options,
			array( 'autoload'    => 'no' ),
			array( 'option_name' => '_transient_' . $transient )
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- No WordPress API exists for updating the autoload column; this is a scoped write to this plugin's own transient timeout row, so object caching is not applicable.
		$wpdb->update(
			$wpdb->options,
			array( 'autoload'    => 'no' ),
			array( 'option_name' => '_transient_timeout_' . $transient )
		);
	}

	/**
	 * Get the latest WordPress revision ID for a post.
	 * Used as a monotonically-increasing conflict-detection token.
	 * Returns 0 if revisions are disabled - callers treat 0 as "skip check".
	 *
	 * NOTE: We use latest_id (the revision's post ID), NOT count.
	 * Count is bounded by the revision limit setting and will plateau, 
	 * making it useless for conflict detection after enough saves.
	 * latest_id always increments.
	 */
	public function get_post_revision_token( $post_id ) {
		$result = wp_get_latest_revision_id_and_total_count( $post_id );
		if ( ! is_wp_error( $result ) && ! empty( $result['latest_id'] ) ) {
			return (int) $result['latest_id'];
		}

		// Fallback for sites that have revisions disabled: use post_modified_gmt as a
		// monotonically-increasing Unix timestamp. The conflict check compares
		// client_token < server_token, so any backend save (which bumps post_modified_gmt)
		// will correctly trigger a conflict even without revision rows.
		$post = get_post( $post_id );
		if (
			$post &&
			! empty( $post->post_modified_gmt ) &&
			$post->post_modified_gmt !== '0000-00-00 00:00:00'
		) {
			return (int) strtotime( $post->post_modified_gmt );
		}

		return 0;
	}

	/**
	 * Delete all element history rows when a post is permanently deleted.
	 *
	 * Hooked to before_delete_post (not delete_post / wp_trash_post) so that:
	 *  - History is only removed on a real, permanent delete - not on trash.
	 *  - The post row still exists at this point, keeping the action consistent
	 *    with the rest of WordPress's before_delete_post contract.
	 *
	 * Pro owns draft-history data and handles its own cleanup when active.
	 *
	 * @param int $post_id The post being permanently deleted.
	 */
	public function on_before_delete_post( int $post_id ): void {
		do_action( 'mwpsfe_before_delete_post', $post_id );
	}

	/**
	 * Render refreshed block HTML for one or more UUIDs from the saved post.
	 *
	 * @param int      $post_id         Post ID.
	 * @param string[] $requested_uuids Block UUIDs to refresh.
	 * @return array<string,mixed> Response-ready payload.
	 */
	public function get_block_html_payload( int $post_id, array $requested_uuids ): array {
		if ( empty( $requested_uuids ) ) {
			return array( 'error' => 'No block UUID provided', 'status' => 400 );
		}

		$post = get_post( $post_id );
		if ( ! MWPSFE_Post_Content_Support::is_supported_post( $post ) ) {
			return array( 'error' => 'Post not found', 'status' => 400 );
		}

		$blocks        = parse_blocks( $post->post_content );
		$missing_uuids = array();
		foreach ( $requested_uuids as $uuid ) {
			$target_block = MWPSFE_Block_Utils::find_block_by_uuid( $blocks, $uuid );
			if ( ! $target_block ) {
				$missing_uuids[] = $uuid;
			}
		}

		if ( ! empty( $missing_uuids ) ) {
			return array( 'error' => 'Block not found', 'status' => 400 );
		}

		$html_map     = $this->render_post_blocks_html( $post, $requested_uuids );
		$missing_html = array_values( array_diff( $requested_uuids, array_keys( $html_map ) ) );

		if ( ! empty( $missing_html ) ) {
			return array( 'error' => 'BLOCK_HTML_REFRESH_FAILED', 'status' => 200 );
		}

		if ( count( $requested_uuids ) > 1 ) {
			return array(
				'html_map' => $html_map,
				'success'  => true,
			);
		}

		return array(
			'html'    => $html_map[ $requested_uuids[0] ] ?? '',
			'success' => true,
		);
	}

	/**
	 * Build authenticated cookies for a same-site loopback request.
	 *
	 * @return array<int,\WP_Http_Cookie>
	 */
	private function build_loopback_cookies(): array {
		$cookies = array();
		foreach ( $_COOKIE as $name => $value ) {
			if ( ! is_string( $name ) ) {
				continue;
			}
			$cookies[] = new \WP_Http_Cookie(
				array(
					'name'  => $name,
					'value' => is_scalar( $value ) ? (string) $value : '',
				)
			);
		}
		return $cookies;
	}

	/**
	 * Fetch the fully rendered frontend page HTML for a post.
	 *
	 * @param WP_Post $post
	 * @return string|null
	 */
	private function fetch_post_page_html( WP_Post $post ): ?string {
		$permalink = get_permalink( $post );
		if ( ! $permalink ) {
			return null;
		}

		$url = add_query_arg(
			array(
				'mwpsfe_refresh' => '1',
				'mwpsfe_ts'      => (string) microtime( true ),
			),
			$permalink
		);

		$response = wp_remote_get(
			$url,
			array(
				'timeout'     => 15,
				'redirection' => 5,
				'headers'     => array(
					'Cache-Control'     => 'no-cache, no-store, must-revalidate',
					'Pragma'            => 'no-cache',
					'X-MWPSFE-Loopback' => '1',
					'User-Agent'        => 'MWPSFE-Block-Refresh-Loopback',
				),
				'cookies'     => $this->build_loopback_cookies(),
			)
		);

		if ( is_wp_error( $response ) ) {
			return null;
		}

		$response_code = (int) wp_remote_retrieve_response_code( $response );
		$body          = wp_remote_retrieve_body( $response );
		$body          = is_string( $body ) ? $body : '';
		if ( 200 !== $response_code || '' === trim( $body ) ) {
			return null;
		}

		return $body;
	}

	/**
	 * Render only the post content pipeline and extract UUID-tagged nodes.
	 *
	 * @param WP_Post  $post
	 * @param string[] $element_uuids
	 * @return array<string,string>
	 */
	private function render_post_content_blocks_html( WP_Post $post, array $element_uuids ): array {
		$previous_global_post = $GLOBALS['post'] ?? null;
		$previous_rest_post   = MWPSFE_UUID_Manager::$current_rest_post_id;
		$rendered_content     = '';

		try {
			// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- The content filter pipeline requires the requested post as its active global context.
			$GLOBALS['post'] = $post;
			setup_postdata( $post );
			MWPSFE_UUID_Manager::$current_rest_post_id = (int) $post->ID;
			// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Intentionally calling core WordPress hook to render content.
			$rendered_content                          = apply_filters( 'the_content', $post->post_content );
		} finally {
			MWPSFE_UUID_Manager::$current_rest_post_id = $previous_rest_post;

			if ( $previous_global_post instanceof WP_Post ) {
				// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Restore the caller's active post context after rendering.
				$GLOBALS['post'] = $previous_global_post;
				setup_postdata( $previous_global_post );
			} else {
				unset( $GLOBALS['post'] );
				wp_reset_postdata();
			}
		}

		if ( ! is_string( $rendered_content ) || '' === trim( $rendered_content ) ) {
			return array();
		}

		return $this->extract_uuid_nodes_from_html( $rendered_content, $element_uuids );
	}

	/**
	 * Extract UUID-tagged block nodes from rendered HTML.
	 *
	 * @param string   $html
	 * @param string[] $element_uuids
	 * @return array<string,string>
	 */
	private function extract_uuid_nodes_from_html( string $html, array $element_uuids ): array {
		$requested = array_values(
			array_filter(
				array_unique(
					array_map(
						static function( $uuid ) {
							return is_string( $uuid ) ? trim( $uuid ) : '';
						},
						$element_uuids
					)
				)
			)
		);
		if ( empty( $requested ) || ! class_exists( '\DOMDocument' ) || ! class_exists( '\DOMXPath' ) ) {
			return array();
		}

		$dom             = new \DOMDocument();
		$libxml_previous = libxml_use_internal_errors( true );

		try {
			if ( ! $dom->loadHTML( $html ) ) {
				return array();
			}
		} finally {
			libxml_clear_errors();
			libxml_use_internal_errors( $libxml_previous );
		}

		$xpath   = new \DOMXPath( $dom );
		$nodes   = $xpath->query( '//*[@data-mwp-sfe-uuid]' );
		$wanted  = array_fill_keys( $requested, true );
		$matches = array();

		if ( $nodes ) {
			foreach ( $nodes as $node ) {
				if ( ! $node instanceof \DOMElement ) {
					continue;
				}
				$uuid = trim( (string) $node->getAttribute( 'data-mwp-sfe-uuid' ) );
				if ( '' === $uuid || ! isset( $wanted[ $uuid ] ) || isset( $matches[ $uuid ] ) ) {
					continue;
				}
				$node_html = $dom->saveHTML( $node );
				if ( is_string( $node_html ) && '' !== trim( $node_html ) ) {
					$matches[ $uuid ] = $node_html;
				}
			}
		}

		return $matches;
	}

	/**
	 * Render saved post HTML and extract the UUID nodes requested by the client.
	 *
	 * @param WP_Post  $post
	 * @param string[] $element_uuids
	 * @return array<string,string>
	 */
	private function render_post_blocks_html( WP_Post $post, array $element_uuids ): array {
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			return $this->render_post_content_blocks_html( $post, $element_uuids );
		}

		$html = $this->fetch_post_page_html( $post );
		if ( ! is_string( $html ) || '' === trim( $html ) ) {
			return array();
		}

		return $this->extract_uuid_nodes_from_html( $html, $element_uuids );
	}
}
