<?php
namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Stable server-side integration facade for trusted FrontEdit extensions.
 *
 * External plugins receive data snapshots from this class and never need to
 * instantiate FrontEdit registries, permissions services, renderers, handlers,
 * schema interfaces, or optional Pro storage classes directly.
 */
class MWPSFE_Public_API {

	/**
	 * Current server-side integration contract generation.
	 */
	private const API_VERSION = 1;

	/**
	 * Singleton instance.
	 *
	 * @var MWPSFE_Public_API|null
	 */
	private static $instance = null;

	/**
	 * Internal integration context service.
	 *
	 * @var MWPSFE_Integration_Context_Service|null
	 */
	private $context_service = null;

	/**
	 * Pending-draft snapshots cached for the current request.
	 *
	 * @var array<string,array<string,mixed>>
	 */
	private $pending_draft_cache = array();

	/**
	 * Return the singleton public API facade.
	 *
	 * @return MWPSFE_Public_API
	 */
	public static function instance(): MWPSFE_Public_API {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	/**
	 * Prevent direct construction.
	 */
	private function __construct() {}

	/**
	 * Describe the stable server-side integration contract.
	 *
	 * @return array<string,mixed>
	 */
	public function get_api_info(): array {
		$pending_draft_state_available = ! mwpsfepro_class_exists()
			|| false !== has_filter( 'mwpsfe_public_api_pending_draft_state' );

		return array(
			'apiVersion' => self::API_VERSION,
			'namespace'  => __CLASS__,
			'features'   => array(
				'authorizedPostContext'          => true,
				'authorizedEditableBlockContext' => true,
				'handlerCatalog'                 => true,
				'publicOperationContracts'       => true,
				'iconLibrary'                    => true,
				'pendingDraftState'              => $pending_draft_state_available,
				'rendering'                      => true,
				'abilityCatalog'                 => true,
				'settingsNotices'                => true,
			),
		);
	}

	/**
	 * Return the current user's authorized FrontEdit post context.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string,mixed>
	 */
	public function get_authorized_post_context( int $post_id ): array {
		return $this->get_context_service()->get_authorized_post_context( $post_id );
	}

	/**
	 * Return the current user's authorized post and effective FrontEdit context.
	 *
	 * Browser-owned dirty changes are layered over saved content through the same
	 * handler and raw-block application path used by FrontEdit. This is a read
	 * projection only; it does not mutate or save the post.
	 *
	 * @param int                            $post_id        Post ID.
	 * @param array<int,array<string,mixed>> $staged_changes Unsaved browser changes.
	 * @return array<string,mixed>
	 */
	public function get_authorized_editable_block_context( int $post_id, array $staged_changes = array() ): array {
		return $this->get_context_service()->get_authorized_editable_block_context( $post_id, $staged_changes );
	}

	/**
	 * Return one authorized block's public operation contract.
	 *
	 * The returned contract is a read model only. Browser integrations must still
	 * preflight and stage operations through `window.MWP.SFE.PublicApi`; this PHP
	 * method never applies or saves an operation.
	 *
	 * @param int                            $post_id        Post ID.
	 * @param string                         $uuid           FrontEdit block UUID.
	 * @param array<int,array<string,mixed>> $staged_changes Unsaved browser changes.
	 * @return array<string,mixed>
	 */
	public function get_public_operation_contract( int $post_id, string $uuid, array $staged_changes = array() ): array {
		return $this->get_context_service()->get_public_operation_contract( $post_id, $uuid, $staged_changes );
	}

	/**
	 * Return data-only schema edit-handler snapshots keyed by handler ID.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public function get_editable_handler_catalog(): array {
		return $this->get_context_service()->get_editable_handler_catalog();
	}

	/**
	 * Return FrontEdit's registered public ability metadata.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function get_public_ability_catalog(): array {
		return MWPSFE_Abilities::instance()->get_public_ability_catalog();
	}

	/**
	 * Return the WordPress Icon Library as public names and labels.
	 *
	 * The registry is the same authority used by the core Icon block and its REST
	 * collection. Trusted integrations can use these values to constrain proposed
	 * replacements without treating an icon name as an attachment URL.
	 *
	 * @return array<int,array{name:string,label:string}> Registered icons.
	 */
	public function get_icon_library(): array {
		$icons = \WP_Icons_Registry::get_instance()->get_registered_icons();
		return array_values( array_map(
			static function( array $icon ): array {
				return array(
					'name'  => (string) $icon['name'],
					'label' => (string) ( $icon['label'] ?? $icon['name'] ),
				);
			},
			$icons
		) );
	}

	/**
	 * Return authorized pending-draft metadata keyed by block UUID.
	 *
	 * Base returns an empty map. FrontEdit Pro supplies its retained draft state
	 * through the documented filter without exposing its database implementation.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string,mixed>
	 */
	public function get_pending_draft_state( int $post_id ): array {
		$authorization = $this->get_context_service()->get_authorized_post_context( $post_id );
		if ( isset( $authorization['error'] ) ) {
			return $authorization;
		}

		$cache_key = get_current_user_id() . ':' . $post_id;
		if ( isset( $this->pending_draft_cache[ $cache_key ] ) ) {
			return $this->pending_draft_cache[ $cache_key ];
		}

		if ( mwpsfepro_class_exists() && false === has_filter( 'mwpsfe_public_api_pending_draft_state' ) ) {
			throw new \RuntimeException( 'FrontEdit Pro is loaded without its public pending-draft state provider.' );
		}

		/**
		 * Filter the pending FrontEdit draft state exposed to trusted integrations.
		 *
		 * The base plugin owns this stable seam. Pro remains the sole owner of draft
		 * persistence and contributes only the normalized read model.
		 *
		 * @param array<string,array<string,mixed>> $pending_by_uuid Pending metadata.
		 * @param int                               $post_id         Authorized post ID.
		 */
		$pending_by_uuid = apply_filters( 'mwpsfe_public_api_pending_draft_state', array(), $post_id );
		if ( ! is_array( $pending_by_uuid ) ) {
			throw new \UnexpectedValueException( 'The FrontEdit pending-draft state provider must return an array.' );
		}

		$pending_by_uuid = $this->normalize_pending_draft_state( $pending_by_uuid );

		$this->pending_draft_cache[ $cache_key ] = array(
			'success'         => true,
			'post_id'         => $post_id,
			'pending_by_uuid' => $pending_by_uuid,
		);

		return $this->pending_draft_cache[ $cache_key ];
	}

	/**
	 * Render one parsed Gutenberg block through WordPress's canonical renderer.
	 *
	 * @param array<string,mixed> $block Parsed Gutenberg block.
	 * @return string
	 */
	public function render_block( array $block ): string {
		return render_block( $block );
	}

	/**
	 * Render serialized block markup through FrontEdit's display renderer.
	 *
	 * @param string $serialized Serialized Gutenberg block markup.
	 * @param bool   $for_email  Whether to use the email rendering context.
	 * @param string $page_url   Optional page URL for rendered media links.
	 * @param string $uuid       Optional block UUID for rendered media links.
	 * @return string
	 */
	public function render_serialized_block( string $serialized, bool $for_email = false, string $page_url = '', string $uuid = '' ): string {
		return MWPSFE_Block_Renderer::render( $serialized, $for_email, $page_url, $uuid );
	}

	/**
	 * Publish a settings notice through FrontEdit's settings screen.
	 *
	 * @param string $message Notice message.
	 * @param string $type    Notice type.
	 * @return void
	 */
	public function set_settings_notice( string $message, string $type = 'success' ): void {
		MWPSFE_Admin::set_settings_notice( $message, $type );
	}

	/**
	 * Return the internal context service, initializing it only when required.
	 *
	 * API version and feature probes therefore remain side-effect free and do not
	 * instantiate handler or permission services.
	 *
	 * @return MWPSFE_Integration_Context_Service
	 */
	private function get_context_service(): MWPSFE_Integration_Context_Service {
		if ( null === $this->context_service ) {
			$this->context_service = MWPSFE_Integration_Context_Service::instance();
		}

		return $this->context_service;
	}

	/**
	 * Normalize the Pro-supplied pending-draft read model.
	 *
	 * @param array $pending_by_uuid Candidate pending-draft map.
	 * @return array<string,array<string,mixed>>
	 */
	private function normalize_pending_draft_state( array $pending_by_uuid ): array {
		$normalized = array();

		foreach ( $pending_by_uuid as $uuid => $metadata ) {
			$uuid = sanitize_text_field( (string) $uuid );
			if ( '' === $uuid || ! is_array( $metadata ) ) {
				continue;
			}

			$normalized[ $uuid ] = array(
				'version' => $metadata['version'] ?? null,
				'user'    => sanitize_text_field( (string) ( $metadata['user'] ?? '' ) ),
				'date'    => sanitize_text_field( (string) ( $metadata['date'] ?? '' ) ),
			);
		}

		return $normalized;
	}
}
