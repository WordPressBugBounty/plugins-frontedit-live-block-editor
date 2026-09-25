<?php
namespace MWPSFE;

use WP_Post;

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Build authorized server-side context for the stable PHP integration facade.
 *
 * This internal service owns access to FrontEdit handlers, permissions, parsed
 * blocks, and raw-block staging so the outward facade stays small and stable.
 */
class MWPSFE_Integration_Context_Service {

	/**
	 * Singleton instance.
	 *
	 * @var MWPSFE_Integration_Context_Service|null
	 */
	private static $instance = null;

	/**
	 * Handler registry.
	 *
	 * @var MWPSFE_Handler_Registry
	 */
	private $handler_registry;

	/**
	 * Permissions service.
	 *
	 * @var MWPSFE_Permissions
	 */
	private $permissions;

	/**
	 * Return the singleton context service.
	 *
	 * @return MWPSFE_Integration_Context_Service
	 */
	public static function instance(): MWPSFE_Integration_Context_Service {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	/**
	 * Construct the service around FrontEdit-owned internals.
	 */
	private function __construct() {
		$this->handler_registry = MWPSFE_Handler_Registry::instance();
		$this->permissions       = MWPSFE_Permissions::instance();
	}

	/**
	 * Return the current user's authorized FrontEdit post context.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string,mixed>
	 */
	public function get_authorized_post_context( int $post_id ): array {
		$authorization = $this->authorize_post( $post_id );
		if ( isset( $authorization['error'] ) ) {
			return $authorization;
		}

		/** @var WP_Post $post */
		$post = $authorization['post'];

		return array(
			'success'     => true,
			'post_id'     => $post_id,
			'title'       => get_the_title( $post ),
			'preview_url' => get_preview_post_link( $post ),
			'permissions' => $authorization['permissions'],
			'content'     => (string) $post->post_content,
		);
	}

	/**
	 * Return authorized editable blocks with dirty browser state applied in memory.
	 *
	 * @param int                            $post_id        Post ID.
	 * @param array<int,array<string,mixed>> $staged_changes Unsaved browser changes.
	 * @return array<string,mixed>
	 */
	public function get_authorized_editable_block_context( int $post_id, array $staged_changes = array() ): array {
		$authorization = $this->authorize_post( $post_id );
		if ( isset( $authorization['error'] ) ) {
			return $authorization;
		}

		/** @var WP_Post $post */
		$post              = $authorization['post'];
		$effective_content = $this->apply_staged_changes( (string) $post->post_content, $staged_changes );
		$blocks            = array();

		$this->collect_editable_block_contexts( parse_blocks( $effective_content ), $blocks );

		return array(
			'success'           => true,
			'post_id'           => $post_id,
			'title'             => get_the_title( $post ),
			'preview_url'       => get_preview_post_link( $post ),
			'permissions'       => $authorization['permissions'],
			'effective_content' => $effective_content,
			'handlers'          => array_values( $this->get_editable_handler_catalog() ),
			'blocks'            => $blocks,
		);
	}

	/**
	 * Return one authorized block's public operation contract.
	 *
	 * @param int                            $post_id        Post ID.
	 * @param string                         $uuid           FrontEdit block UUID.
	 * @param array<int,array<string,mixed>> $staged_changes Unsaved browser changes.
	 * @return array<string,mixed>
	 */
	public function get_public_operation_contract( int $post_id, string $uuid, array $staged_changes = array() ): array {
		$authorization = $this->authorize_post( $post_id );
		if ( isset( $authorization['error'] ) ) {
			return $authorization;
		}

		/** @var WP_Post $post */
		$post    = $authorization['post'];
		$uuid    = sanitize_text_field( $uuid );
		$content = $this->apply_staged_changes( (string) $post->post_content, $staged_changes );
		$block   = MWPSFE_Block_Utils::find_block_by_uuid( parse_blocks( $content ), $uuid );

		if ( ! is_array( $block ) ) {
			return array(
				'error'  => 'Editable block not found',
				'status' => 404,
			);
		}

		$handler = $this->resolve_schema_edit_handler( $block );
		if ( ! $handler instanceof MWPSFE_Schema_Handler_Interface ) {
			return array(
				'error'  => 'Public operation contract unavailable',
				'status' => 422,
			);
		}

		$contract = MWPSFE_Public_Operation_Contract::build( $uuid, $block, $handler );
		if ( empty( $contract ) ) {
			return array(
				'error'  => 'Public operation contract unavailable',
				'status' => 422,
			);
		}

		return array(
			'success'                 => true,
			'post_id'                 => $post_id,
			'handler_id'              => sanitize_key( (string) $handler->id() ),
			'contract'                => $contract,
			'current_operation_state' => MWPSFE_Public_Operation_Contract::build_current_operation_state( $block, $handler ),
			'page_revision_token'     => MWPSFE_Manager::instance()->get_post_revision_token( $post_id ),
		);
	}

	/**
	 * Return data-only schema edit-handler snapshots keyed by handler ID.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public function get_editable_handler_catalog(): array {
		$catalog = array();
		$configs = array();

		foreach ( $this->handler_registry->handlers_list() as $config ) {
			if ( is_array( $config ) && isset( $config['id'] ) ) {
				$configs[ sanitize_key( (string) $config['id'] ) ] = $config;
			}
		}

		foreach ( $this->handler_registry->get_handlers() as $handler ) {
			if (
				! $handler instanceof MWPSFE_Handler_Interface
				|| ! $handler instanceof MWPSFE_Schema_Handler_Interface
				|| 'edit' !== $handler->capability()
			) {
				continue;
			}

			$handler_id             = sanitize_key( (string) $handler->id() );
			$catalog[ $handler_id ] = array(
				'id'               => $handler_id,
				'element_type'     => sanitize_text_field( (string) $handler->element_type() ),
				'supported_blocks' => array_values( array_map( 'strval', (array) $handler->get_supported_blocks() ) ),
				'schema'           => (array) $handler->get_schema_definition(),
				'config'           => (array) ( $configs[ $handler_id ] ?? array() ),
			);
		}

		return $catalog;
	}

	/**
	 * Authorize the current user against one supported FrontEdit post.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string,mixed>
	 */
	private function authorize_post( int $post_id ): array {
		$post = get_post( $post_id );
		if ( ! MWPSFE_Post_Content_Support::is_supported_post( $post ) ) {
			return array(
				'error'  => 'Post not found',
				'status' => 404,
			);
		}

		$permissions = $this->permissions->get_user_effective_permissions( get_current_user_id(), $post_id );
		if ( empty( $permissions['can_publish'] ) && empty( $permissions['can_draft'] ) ) {
			return array(
				'error'  => 'You are not authorized to edit this post with FrontEdit.',
				'status' => 403,
			);
		}

		return array(
			'post'        => $post,
			'permissions' => $permissions,
		);
	}

	/**
	 * Layer browser-owned dirty changes over serialized post content.
	 *
	 * @param string                         $content        Saved post content.
	 * @param array<int,array<string,mixed>> $staged_changes Unsaved browser changes.
	 * @return string
	 */
	private function apply_staged_changes( string $content, array $staged_changes ): string {
		if ( empty( $staged_changes ) ) {
			return $content;
		}

		$blocks = parse_blocks( $content );

		foreach ( $staged_changes as $change ) {
			if ( ! is_array( $change ) ) {
				continue;
			}

			$uuid         = sanitize_text_field( (string) ( $change['element_uuid'] ?? '' ) );
			$handler_id   = sanitize_key( (string) ( $change['handler_id'] ?? '' ) );
			$after_raw    = (string) ( $change['after_raw'] ?? ( $change['after'] ?? '' ) );
			$target_block = MWPSFE_Block_Utils::find_block_by_uuid( $blocks, $uuid );

			if ( '' === $uuid || '' === trim( $after_raw ) || ! is_array( $target_block ) ) {
				continue;
			}

			$handler = $this->resolve_schema_edit_handler( $target_block, $handler_id );
			if ( ! $handler instanceof MWPSFE_Handler_Interface ) {
				continue;
			}

			$payload = wp_json_encode(
				array(
					'_type'      => 'raw_block_content',
					'rawContent' => $after_raw,
				)
			);

			MWPSFE_Block_Utils::update_block_by_uuid(
				$blocks,
				$uuid,
				$payload,
				$handler,
				(array) ( $target_block['attrs'] ?? array() )
			);
		}

		return serialize_blocks( $blocks );
	}

	/**
	 * Collect data-only editable block records from a parsed block tree.
	 *
	 * @param array<int,array<string,mixed>> $blocks   Parsed blocks.
	 * @param array<int,array<string,mixed>> $contexts Collected records.
	 * @return void
	 */
	private function collect_editable_block_contexts( array $blocks, array &$contexts ): void {
		foreach ( $blocks as $block ) {
			if ( ! is_array( $block ) ) {
				continue;
			}

			$uuid    = sanitize_text_field( (string) ( $block['attrs']['mwpSfeUuidShadow'] ?? ( $block['attrs']['mwpSfeUuid'] ?? '' ) ) );
			$handler = $this->resolve_schema_edit_handler( $block );

			if ( '' !== $uuid && $handler instanceof MWPSFE_Schema_Handler_Interface ) {
				$contexts[] = array(
					'uuid'          => $uuid,
					'block'         => $block,
					'block_name'    => (string) ( $block['blockName'] ?? '' ),
					'raw_content'   => serialize_blocks( array( $block ) ),
					'rendered_html' => render_block( $block ),
					'handler'       => array(
						'id'               => sanitize_key( (string) $handler->id() ),
						'element_type'     => sanitize_text_field( (string) $handler->element_type() ),
						'supported_blocks' => array_values( array_map( 'strval', (array) $handler->get_supported_blocks() ) ),
						'schema'           => (array) $handler->get_schema_definition(),
					),
					'public_operation_contract' => MWPSFE_Public_Operation_Contract::build( $uuid, $block, $handler ),
					'current_operation_state'   => MWPSFE_Public_Operation_Contract::build_current_operation_state( $block, $handler ),
				);
			}

			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$this->collect_editable_block_contexts( $block['innerBlocks'], $contexts );
			}
		}
	}

	/**
	 * Resolve one schema-backed edit handler for a parsed block.
	 *
	 * @param array<string,mixed> $block      Parsed block.
	 * @param string              $handler_id Optional preferred handler ID.
	 * @return MWPSFE_Handler_Interface|null
	 */
	private function resolve_schema_edit_handler( array $block, string $handler_id = '' ): ?MWPSFE_Handler_Interface {
		if ( '' !== $handler_id ) {
			$handler = $this->handler_registry->get_handler( $handler_id );
			if (
				$handler instanceof MWPSFE_Handler_Interface
				&& $handler instanceof MWPSFE_Schema_Handler_Interface
				&& 'edit' === $handler->capability()
				&& $handler->can_handle_block( $block )
			) {
				return $handler;
			}
		}

		foreach ( $this->handler_registry->get_handlers() as $handler ) {
			if (
				$handler instanceof MWPSFE_Handler_Interface
				&& $handler instanceof MWPSFE_Schema_Handler_Interface
				&& 'edit' === $handler->capability()
				&& $handler->can_handle_block( $block )
			) {
				return $handler;
			}
		}

		return null;
	}
}
