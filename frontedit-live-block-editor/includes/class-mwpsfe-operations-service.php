<?php
namespace MWPSFE;

use WP_Post;
use WP_Query;

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Execute shared standalone FrontEdit operations for REST routes and abilities.
 */
class MWPSFE_Operations_Service {

	/**
	 * Singleton instance.
	 *
	 * @var MWPSFE_Operations_Service|null
	 */
	private static $instance = null;

	/**
	 * Manager instance.
	 *
	 * @var MWPSFE_Manager
	 */
	private $manager;

	/**
	 * Handler registry instance.
	 *
	 * @var MWPSFE_Handler_Registry
	 */
	private $handler_registry;

	/**
	 * UUID manager instance.
	 *
	 * @var MWPSFE_UUID_Manager
	 */
	private $uuid_manager;

	/** @var MWPSFE_Post_Lock_Service */
	private $post_lock_service;

	/**
	 * Get the singleton instance.
	 *
	 * @return MWPSFE_Operations_Service
	 */
	public static function instance(): MWPSFE_Operations_Service {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	/**
	 * Constructor.
	 */
	private function __construct() {
		$this->manager           = MWPSFE_Manager::instance();
		$this->handler_registry  = MWPSFE_Handler_Registry::instance();
		$this->uuid_manager      = MWPSFE_UUID_Manager::instance();
		$this->post_lock_service = MWPSFE_Post_Lock_Service::instance();
	}

	/**
	 * Build a discoverable catalog of editable blocks for a post.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string,mixed>
	 */
	public function list_editable_blocks( int $post_id ): array {
		$post = $this->get_supported_post( $post_id );
		if ( ! $post instanceof WP_Post ) {
			return array(
				'error'  => 'Post not found',
				'status' => 404,
			);
		}

		$uuid_map = $this->uuid_manager->get_cached_uuid_map( $post_id );
		$blocks   = array();

		foreach ( $uuid_map as $uuid => $data ) {
			$block = $data['block'] ?? null;
			if ( ! is_array( $block ) || empty( $block['blockName'] ) ) {
				continue;
			}

			$serialized = serialize_block( $block );
			$blocks[]   = array(
				'element_uuid'        => sanitize_text_field( (string) $uuid ),
				'blockName'           => (string) ( $block['blockName'] ?? '' ),
				'attrs'               => $block['attrs'] ?? array(),
				'innerHTML'           => $block['innerHTML'] ?? '',
				'innerBlocks'         => $block['innerBlocks'] ?? array(),
				'innerContent'        => $block['innerContent'] ?? array(),
				'html'                => render_block( $block ),
				'rawContent'          => $serialized,
				'handlers'            => $data['handlers'] ?? array(),
				'page_revision_token' => $this->manager->get_post_revision_token( $post_id ),
			);
		}

		return array(
			'success'             => true,
			'blocks'              => $blocks,
			'page_revision_token' => $this->manager->get_post_revision_token( $post_id ),
		);
	}

	/**
	 * Build the compact, read-only editable-block index used by AI discovery.
	 *
	 * This intentionally exposes neither serialized Gutenberg block markup nor
	 * the complete parsed block tree. Browser integrations use the UUID returned
	 * here to inspect the supported live runtime on the rendered page.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string,mixed>
	 */
	public function list_editable_block_summaries( int $post_id ): array {
		$post = $this->get_supported_post( $post_id );
		if ( ! $post instanceof WP_Post ) {
			return array(
				'error'  => 'Post not found',
				'status' => 404,
			);
		}

		$blocks = array();
		foreach ( $this->uuid_manager->get_cached_uuid_map( $post_id ) as $uuid => $data ) {
			$summary = $this->build_editable_block_summary( (string) $uuid, $data );
			if ( $summary ) {
				$blocks[] = $summary;
			}
		}

		return array(
			'success'             => true,
			'post_id'             => $post_id,
			'blocks'              => $blocks,
			'page_revision_token' => $this->manager->get_post_revision_token( $post_id ),
		);
	}

	/**
	 * Return focused read-only content for one editable block UUID.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $uuid    FrontEdit block UUID.
	 * @return array<string,mixed>
	 */
	public function get_editable_block( int $post_id, string $uuid ): array {
		$post = $this->get_supported_post( $post_id );
		if ( ! $post instanceof WP_Post ) {
			return array(
				'error'  => 'Post not found',
				'status' => 404,
			);
		}

		$uuid_map = $this->uuid_manager->get_cached_uuid_map( $post_id );
		$data     = $uuid_map[ $uuid ] ?? null;
		if ( ! is_array( $data ) || ! isset( $data['block'] ) || ! is_array( $data['block'] ) ) {
			return array(
				'error'  => 'Editable block not found',
				'status' => 404,
			);
		}

		$summary = $this->build_editable_block_summary( $uuid, $data );
		if ( ! $summary ) {
			return array(
				'error'  => 'Editable block not found',
				'status' => 404,
			);
		}

		$block = $data['block'];

		return array_merge(
			$summary,
			array(
				'inner_html'          => (string) ( $block['innerHTML'] ?? '' ),
				'rendered_html'       => render_block( $block ),
				'page_revision_token' => $this->manager->get_post_revision_token( $post_id ),
			)
		);
	}

	/**
	 * Shape one safe discovery record from a UUID-map entry.
	 *
	 * @param string              $uuid FrontEdit block UUID.
	 * @param array<string,mixed> $data UUID-map entry.
	 * @return array<string,mixed>|null
	 */
	private function build_editable_block_summary( string $uuid, array $data ): ?array {
		$block = $data['block'] ?? null;
		if ( '' === $uuid || ! is_array( $block ) || empty( $block['blockName'] ) ) {
			return null;
		}

		$handler_ids = array();
		foreach ( (array) ( $data['handlers'] ?? array() ) as $handler_id ) {
			$handler = $this->handler_registry->get_handler( (string) $handler_id );
			if ( $handler && 'edit' === $handler->capability() ) {
				$handler_ids[] = $handler->id();
			}
		}

		if ( empty( $handler_ids ) ) {
			return null;
		}

		return array(
			'uuid'        => $uuid,
			'block_name'  => (string) $block['blockName'],
			'handler_ids' => array_values( array_unique( $handler_ids ) ),
			'source_text' => wp_strip_all_tags( (string) ( $data['text'] ?? '' ), true ),
		);
	}

	/**
	 * Build a preview payload for a block edit request.
	 *
	 * @param int    $post_id      Post ID.
	 * @param string $element_uuid Block UUID.
	 * @param string $handler_id   Handler ID.
	 * @param mixed  $edit_content Raw edit payload.
	 * @return array<string,mixed>
	 */
	public function preview_block_edit( int $post_id, string $element_uuid, string $handler_id, $edit_content ): array {
		$post    = $this->get_supported_post( $post_id );
		$handler = $this->handler_registry->get_handler( $handler_id );

		if ( ! $post || ! $handler ) {
			return array(
				'error'  => 'Post or Handler not found',
				'status' => 400,
			);
		}

		if ( 'edit' !== $handler->capability() ) {
			return array(
				'error'  => 'Handler cannot edit',
				'status' => 400,
			);
		}

		$target_block = $this->find_block_for_post( $post, $post_id, $element_uuid );
		if ( ! $target_block ) {
			return array(
				'error'  => 'Block not found with UUID: ' . $element_uuid,
				'status' => 400,
			);
		}

		$before = $target_block['innerHTML'] ?? '';
		$after  = $handler->generate_preview(
			$edit_content,
			$target_block,
			array( 'post' => $post )
		);

		return array(
			'original'    => $before,
			'before_html' => $before,
			'after_html'  => $after,
		);
	}

	/**
	 * Apply a single block edit through the normal FrontEdit save pipeline.
	 *
	 * @param int    $post_id              Post ID.
	 * @param string $element_uuid         Block UUID.
	 * @param string $handler_id           Handler ID.
	 * @param mixed  $edit_content         Raw edit payload.
	 * @param int    $page_revision_token  Optional optimistic concurrency token.
	 * @return array<string,mixed>
	 */
	public function apply_block_edit( int $post_id, string $element_uuid, string $handler_id, $edit_content, int $page_revision_token = 0 ): array {
		$post    = $this->get_supported_post( $post_id );
		$handler = $this->handler_registry->get_handler( $handler_id );

		if ( ! $post || ! $handler ) {
			return array(
				'error'  => 'Post or Handler not found',
				'status' => 400,
			);
		}

		if ( 'edit' !== $handler->capability() ) {
			return array(
				'error'  => 'Handler cannot edit',
				'status' => 400,
			);
		}

		if ( ! $this->find_block_for_post( $post, $post_id, $element_uuid ) ) {
			return array(
				'error'  => 'Block not found with UUID: ' . $element_uuid,
				'status' => 400,
			);
		}

		$lock_error = $this->post_lock_service->guard_write( $post_id );
		if ( $lock_error ) {
			return $lock_error;
		}

		if ( $page_revision_token > 0 ) {
			$server_token = $this->manager->get_post_revision_token( $post_id );
			if ( $server_token > $page_revision_token ) {
				return array(
					'error'  => 'REVISION_CONFLICT',
					'status' => 200,
				);
			}
		}

		$result = $handler->apply_edit( $post, $element_uuid, $edit_content );

		if ( isset( $result['status'] ) && 'success' === $result['status'] ) {
			return array(
				'applied_text'        => $edit_content,
				'page_revision_token' => $this->manager->get_post_revision_token( $post_id ),
			);
		}

		if ( ! is_array( $result ) ) {
			return array(
				'error'  => 'Unknown apply result.',
				'status' => 500,
			);
		}

		return $result;
	}

	/**
	 * Return full block state for one UUID.
	 *
	 * @param int    $post_id      Post ID.
	 * @param string $element_uuid Block UUID.
	 * @return array<string,mixed>
	 */
	public function get_block_state( int $post_id, string $element_uuid ): array {
		$post = $this->get_supported_post( $post_id );
		if ( ! $post ) {
			return array(
				'error'  => 'Post not found',
				'status' => 400,
			);
		}

		$target_block = $this->find_block_for_post( $post, $post_id, $element_uuid );
		if ( ! $target_block ) {
			return array(
				'error'  => 'Block not found',
				'status' => 400,
			);
		}

		return array(
			'attrs'               => $target_block['attrs'] ?? array(),
			'blockName'           => $target_block['blockName'] ?? '',
			'innerHTML'           => $target_block['innerHTML'] ?? '',
			'innerBlocks'         => $target_block['innerBlocks'] ?? array(),
			'innerContent'        => $target_block['innerContent'] ?? array(),
			'html'                => render_block( $target_block ),
			'rawContent'          => serialize_block( $target_block ),
			'page_revision_token' => $this->manager->get_post_revision_token( $post_id ),
			'success'             => true,
		);
	}

	/**
	 * Return the full editable block state needed to stage a multi-block edit
	 * session in the browser.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string,mixed>
	 */
	public function get_page_block_tree( int $post_id ): array {
		$post = $this->get_supported_post( $post_id );
		if ( ! $post instanceof WP_Post ) {
			return array(
				'error'  => 'Post not found',
				'status' => 404,
			);
		}

		$elements = array();
		foreach ( $this->uuid_manager->get_cached_uuid_map( $post_id ) as $uuid => $data ) {
			$block = $data['block'] ?? null;
			if ( ! is_array( $block ) || empty( $block['blockName'] ) ) {
				continue;
			}

			$serialized        = serialize_block( $block );
			$elements[ $uuid ] = array(
				'attrs'        => $block['attrs'] ?? array(),
				'blockName'    => $block['blockName'] ?? '',
				'innerHTML'    => $block['innerHTML'] ?? '',
				'innerBlocks'  => $block['innerBlocks'] ?? array(),
				'innerContent' => $block['innerContent'] ?? array(),
				'html'         => render_block( $block ),
				'rawContent'   => $serialized,
				'serialized'   => $serialized,
				'handlers'     => $data['handlers'] ?? array(),
			);
		}

		return array(
			'success'             => true,
			'elements'            => $elements,
			'page_revision_token' => $this->manager->get_post_revision_token( $post_id ),
		);
	}

	/**
	 * Apply multiple raw block edits in one post update.
	 *
	 * Each block still emits the normal `mwpsfe_block_saved` action, allowing
	 * Pro catalog/history listeners to record the edits without making the
	 * shared Base save service depend on Pro.
	 *
	 * @param int   $post_id             Post ID.
	 * @param mixed $changes             Raw changes payload.
	 * @param int   $page_revision_token Optional optimistic concurrency token.
	 * @return array<string,mixed>
	 */
	public function apply_batch_edits( int $post_id, $changes, int $page_revision_token = 0 ): array {
		$changes = $this->normalize_batch_changes( $changes );
		$post    = $this->get_supported_post( $post_id );

		if ( ! $post instanceof WP_Post ) {
			return array(
				'error'  => 'Post not found',
				'status' => 404,
			);
		}

		if ( empty( $changes ) ) {
			return array(
				'error'  => 'No batch changes provided',
				'status' => 400,
			);
		}

		$lock_error = $this->post_lock_service->guard_write( $post_id );
		if ( $lock_error ) {
			$lock_error['conflicted_uuids'] = array_values( wp_list_pluck( $changes, 'element_uuid' ) );
			return $lock_error;
		}

		if ( $page_revision_token > 0 && $this->manager->get_post_revision_token( $post_id ) > $page_revision_token ) {
			return array(
				'error'            => 'REVISION_CONFLICT',
				'conflicted_uuids' => array_values( wp_list_pluck( $changes, 'element_uuid' ) ),
				'status'           => 200,
			);
		}

		$blocks         = parse_blocks( $post->post_content );
		$history_events = array();

		foreach ( $changes as $change ) {
			$element_uuid = $change['element_uuid'];
			$handler_id   = $change['handler_id'];
			$target_block = MWPSFE_Block_Utils::find_block_by_uuid( $blocks, $element_uuid );

			if ( ! $target_block ) {
				return array(
					'error'  => 'Block not found: ' . $element_uuid,
					'status' => 404,
				);
			}

			if ( $this->uuid_manager->has_external_block_bindings( $target_block ) ) {
				return array(
					'error'  => 'Block bindings are not supported by FrontEdit.',
					'status' => 400,
				);
			}

			$handler = '' !== $handler_id ? $this->handler_registry->get_handler( $handler_id ) : null;
			if ( ! $handler ) {
				foreach ( $this->handler_registry->get_handlers() as $candidate ) {
					if ( 'edit' === $candidate->capability() && $candidate->can_handle_block( $target_block ) ) {
						$handler = $candidate;
						break;
					}
				}
			}

			if ( ! $handler || 'edit' !== $handler->capability() ) {
				return array(
					'error'  => 'Edit handler not found for UUID: ' . $element_uuid,
					'status' => 400,
				);
			}

			$before_serialized = serialize_blocks( array( $target_block ) );
			$updated           = MWPSFE_Block_Utils::update_block_by_uuid(
				$blocks,
				$element_uuid,
				$change['edit_content'],
				$handler,
				$target_block['attrs'] ?? array()
			);

			if ( ! $updated ) {
				return array(
					'error'  => 'Failed to update block: ' . $element_uuid,
					'status' => 500,
				);
			}

			$updated_block = MWPSFE_Block_Utils::find_block_by_uuid( $blocks, $element_uuid );
			if ( ! $updated_block ) {
				return array(
					'error'  => 'Updated block not found: ' . $element_uuid,
					'status' => 500,
				);
			}

			$after_serialized = serialize_blocks( array( $updated_block ) );
			if ( $before_serialized !== $after_serialized ) {
				$history_events[] = array(
					'element_uuid' => $element_uuid,
					'before_raw'   => $before_serialized,
					'after_raw'    => $after_serialized,
					'edit_content' => $change['edit_content'],
					'handler_id'   => $handler->id(),
				);
			}
		}

		if ( empty( $history_events ) ) {
			return array(
				'success'             => true,
				'updated'             => array(),
				'page_revision_token' => $this->manager->get_post_revision_token( $post_id ),
			);
		}

		do_action( 'mwpsfe_batch_edit_started', $post_id );
		MWPSFE_Manager::$suppress_history_auto_record = true;
		$result = wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => wp_slash( serialize_blocks( $blocks ) ),
			),
			true
		);
		MWPSFE_Manager::$suppress_history_auto_record = false;

		if ( is_wp_error( $result ) ) {
			do_action( 'mwpsfe_batch_edit_cancelled', $post_id );
			return array(
				'error'  => 'Failed to save post',
				'status' => 500,
			);
		}

		$updated_uuids = array();
		foreach ( $history_events as $event ) {
			$updated_uuids[] = $event['element_uuid'];
			do_action(
				'mwpsfe_block_saved',
				$post_id,
				$event['element_uuid'],
				$event['before_raw'],
				$event['after_raw'],
				$event['edit_content'],
				$event['handler_id']
			);
		}

		do_action( 'mwpsfe_batch_edit_completed', $post_id );

		return array(
			'success'             => true,
			'updated'             => $updated_uuids,
			'page_revision_token' => $this->manager->get_post_revision_token( $post_id ),
		);
	}

	/**
	 * Normalize incoming batch changes into the canonical REST shape.
	 *
	 * @param mixed $changes Raw changes payload.
	 * @return array<int,array{element_uuid:string,handler_id:string,edit_content:string}>
	 */
	private function normalize_batch_changes( $changes ): array {
		$normalized = array();
		if ( ! is_array( $changes ) ) {
			return $normalized;
		}

		foreach ( $changes as $change ) {
			if ( ! is_array( $change ) ) {
				continue;
			}

			$element_uuid = sanitize_text_field( $change['element_uuid'] ?? '' );
			$handler_id   = sanitize_text_field( $change['handler_id'] ?? '' );
			$edit_content = isset( $change['edit_content'] ) ? (string) $change['edit_content'] : '';

			if ( '' === $element_uuid || '' === $edit_content ) {
				continue;
			}

			$normalized[] = array(
				'element_uuid' => $element_uuid,
				'handler_id'   => $handler_id,
				'edit_content' => $edit_content,
			);
		}

		return $normalized;
	}

	/**
	 * Return paginated media library items.
	 *
	 * @param int    $page       Page number.
	 * @param int    $per_page   Items per page.
	 * @param string $media_type Requested media type.
	 * @return array<string,mixed>
	 */
	public function get_media_library( int $page = 1, int $per_page = 20, string $media_type = '' ): array {
		$args = array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'posts_per_page' => $per_page,
			'paged'          => $page,
			'orderby'        => 'date',
			'order'          => 'DESC',
		);

		if ( 'image_or_video' === $media_type ) {
			$args['post_mime_type'] = array( 'image', 'video' );
		} else {
			$mime_type_map = array(
				'image' => 'image',
				'audio' => 'audio',
				'video' => 'video',
				'file'  => '',
			);

			if ( isset( $mime_type_map[ $media_type ] ) && $mime_type_map[ $media_type ] ) {
				$args['post_mime_type'] = $mime_type_map[ $media_type ];
			}
		}

		$query = new WP_Query( $args );
		$items = array();

		foreach ( $query->posts as $attachment ) {
			$items[] = array(
				'id'    => $attachment->ID,
				'url'   => wp_get_attachment_url( $attachment->ID ),
				'title' => $attachment->post_title,
				'thumb' => wp_get_attachment_image_url( $attachment->ID, 'thumbnail' ),
				'type'  => get_post_mime_type( $attachment->ID ),
			);
		}

		return array(
			'items'       => $items,
			'total'       => $query->found_posts,
			'page'        => $page,
			'per_page'    => $per_page,
			'total_pages' => $query->max_num_pages,
		);
	}

	/**
	 * Resolve normalized attachment attributes for media saves.
	 *
	 * @param int    $attachment_id Attachment ID.
	 * @param string $size_slug     Requested size slug.
	 * @return array<string,mixed>
	 */
	public function resolve_media_attributes( int $attachment_id, string $size_slug = '' ): array {
		if ( $attachment_id <= 0 ) {
			return array(
				'error'  => 'Invalid attachment ID.',
				'status' => 400,
			);
		}

		$attachment = get_post( $attachment_id );
		if ( ! ( $attachment instanceof WP_Post ) || 'attachment' !== $attachment->post_type ) {
			return array(
				'error'  => 'Attachment not found.',
				'status' => 404,
			);
		}

		$mime_type = (string) get_post_mime_type( $attachment_id );
		$is_image  = wp_attachment_is_image( $attachment_id );
		$url       = (string) wp_get_attachment_url( $attachment_id );
		$width     = null;
		$height    = null;
		$is_sized  = false;

		if ( $is_image && '' !== $size_slug ) {
			$resolved = image_downsize( $attachment_id, $size_slug );
			if ( is_array( $resolved ) && ! empty( $resolved[0] ) ) {
				$url      = (string) $resolved[0];
				$width    = isset( $resolved[1] ) ? (int) $resolved[1] : null;
				$height   = isset( $resolved[2] ) ? (int) $resolved[2] : null;
				$is_sized = ! empty( $resolved[3] );
			}
		}

		if ( null === $width || null === $height ) {
			$meta = wp_get_attachment_metadata( $attachment_id );
			if ( is_array( $meta ) ) {
				if ( isset( $meta['width'] ) ) {
					$width = (int) $meta['width'];
				}
				if ( isset( $meta['height'] ) ) {
					$height = (int) $meta['height'];
				}
			}
		}

		return array(
			'success'      => true,
			'attachmentId' => $attachment_id,
			'url'          => $url,
			'width'        => $width,
			'height'       => $height,
			'sizeSlug'     => $size_slug,
			'isImage'      => $is_image,
			'isSized'      => $is_sized,
			'mimeType'     => $mime_type,
		);
	}

	/**
	 * Resolve an eligible FrontEdit post by ID.
	 *
	 * @param int $post_id Post ID.
	 * @return WP_Post|null Eligible post, if any.
	 */
	private function get_supported_post( int $post_id ): ?WP_Post {
		$post = get_post( $post_id );

		return MWPSFE_Post_Content_Support::is_supported_post( $post ) ? $post : null;
	}

	/**
	 * Resolve one FrontEdit-editable block from the post content or cached UUID map.
	 *
	 * @param WP_Post $post         Post object.
	 * @param int     $post_id      Post ID.
	 * @param string  $element_uuid Block UUID.
	 * @return array|null
	 */
	private function find_block_for_post( WP_Post $post, int $post_id, string $element_uuid ): ?array {
		$uuid_map = $this->uuid_manager->get_cached_uuid_map( $post_id );

		if ( isset( $uuid_map[ $element_uuid ] ) && isset( $uuid_map[ $element_uuid ]['block'] ) ) {
			return $uuid_map[ $element_uuid ]['block'];
		}

		$blocks       = parse_blocks( $post->post_content );
		$target_block = MWPSFE_Block_Utils::find_block_by_uuid( $blocks, $element_uuid );

		return is_array( $target_block ) && ! $this->uuid_manager->has_external_block_bindings( $target_block )
			? $target_block
			: null;
	}
}
