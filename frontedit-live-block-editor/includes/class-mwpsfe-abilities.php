<?php
namespace MWPSFE;

use WP_Error;

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Register and describe WordPress abilities for the FrontEdit capability surface.
 */
class MWPSFE_Abilities {

	/**
	 * Singleton instance.
	 *
	 * @var MWPSFE_Abilities|null
	 */
	private static $instance = null;

	/**
	 * Permissions service.
	 *
	 * @var MWPSFE_Permissions
	 */
	private $permissions;

	/**
	 * Shared read-operation service.
	 *
	 * @var MWPSFE_Operations_Service
	 */
	private $operations_service;

	/**
	 * Get the singleton instance.
	 *
	 * @return MWPSFE_Abilities
	 */
	public static function instance(): MWPSFE_Abilities {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	/**
	 * Constructor.
	 */
	private function __construct() {
		$this->permissions        = MWPSFE_Permissions::instance();
		$this->operations_service = MWPSFE_Operations_Service::instance();
	}

	/**
	 * Register hooks for abilities when the API is available.
	 *
	 * @return void
	 */
	public function init(): void {
		if ( ! $this->is_api_available() ) {
			return;
		}

		add_action( 'wp_abilities_api_categories_init', array( $this, 'register_categories' ) );
		add_action( 'wp_abilities_api_init', array( $this, 'register_abilities' ) );
	}

	/**
	 * Check whether the site supports the WordPress abilities API.
	 *
	 * @return bool
	 */
	public function is_api_available(): bool {
		return function_exists( 'wp_register_ability' ) && function_exists( 'wp_get_ability' );
	}

	/**
	 * Register ability categories.
	 *
	 * @return void
	 */
	public function register_categories(): void {
		if ( ! function_exists( 'wp_register_ability_category' ) ) {
			return;
		}

		wp_register_ability_category(
			'mwpsfe-read',
			array(
				'label'       => 'FrontEdit Read',
				'description' => 'FrontEdit runtime integration and discovery.',
			)
		);
	}

	/**
	 * Register all FrontEdit abilities.
	 *
	 * @return void
	 */
	public function register_abilities(): void {
		foreach ( $this->get_ability_definitions() as $name => $definition ) {
			wp_register_ability(
				$name,
				array(
					'label'               => $definition['label'],
					'description'         => $definition['description'],
					'category'            => $definition['category'],
					'meta'                => $definition['meta'],
					'permission_callback' => $definition['permission_callback'],
					'execute_callback'    => $definition['execute_callback'],
					'input_schema'        => $definition['input_schema'],
					'output_schema'       => $definition['output_schema'],
				)
			);
		}
	}

	/**
	 * Build ability definitions and callbacks.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	private function get_ability_definitions(): array {
		$definitions = array(
			'mwpsfe/list-editable-blocks' => array(
				'label'               => 'List Editable Blocks',
				'description'         => 'List the authorized post\'s FrontEdit-editable blocks and UUIDs for browser-runtime selection.',
				'category'            => 'mwpsfe-read',
				'meta'                => $this->build_meta( true, true, false ),
				'permission_callback' => array( $this, 'permission_can_edit' ),
				'execute_callback'    => function( $input ) {
					$input = $this->normalize_ability_input( $input );
					return $this->normalize_execution_result(
						$this->operations_service->list_editable_block_summaries( (int) ( $input['post_id'] ?? 0 ) )
					);
				},
				'input_schema' => array(
					'type' => 'object',
					'properties' => array(
						'post_id' => array( 'type' => 'integer' ),
					),
					'required' => array( 'post_id' ),
				),
				'output_schema' => array(
					'type' => 'object',
				),
			),
			'mwpsfe/get-editable-block' => array(
				'label'               => 'Get Editable Block',
				'description'         => 'Return authorized read-only content and runtime-selection metadata for one FrontEdit block UUID.',
				'category'            => 'mwpsfe-read',
				'meta'                => $this->build_meta( true, true, false ),
				'permission_callback' => array( $this, 'permission_can_edit' ),
				'execute_callback'    => function( $input ) {
					$input = $this->normalize_ability_input( $input );
					return $this->normalize_execution_result(
						$this->operations_service->get_editable_block(
							(int) ( $input['post_id'] ?? 0 ),
							sanitize_text_field( (string) ( $input['uuid'] ?? '' ) )
						)
					);
				},
				'input_schema' => array(
					'type' => 'object',
					'properties' => array(
						'post_id' => array( 'type' => 'integer' ),
						'uuid'    => array( 'type' => 'string' ),
					),
					'required' => array( 'post_id', 'uuid' ),
				),
				'output_schema' => array(
					'type' => 'object',
				),
			),
			'mwpsfe/get-frontend-runtime-contract' => array(
				'label'               => 'Get Frontend Runtime Contract',
				'description'         => 'Return the canonical FrontEdit browser runtime contract for an authorized post editor.',
				'category'            => 'mwpsfe-read',
				'meta'                => $this->build_meta( true, true, false ),
				'permission_callback' => array( $this, 'permission_can_edit' ),
				'execute_callback'    => function( $input ) {
					return $this->normalize_execution_result( $this->get_frontend_runtime_contract() );
				},
				'input_schema' => array(
					'type' => 'object',
					'properties' => array(
						'post_id' => array( 'type' => 'integer' ),
					),
					'required' => array( 'post_id' ),
				),
				'output_schema' => array(
					'type' => 'object',
				),
			),
		);

		return $definitions;
	}

	/**
	 * Authorize FrontEdit discovery data and browser-runtime contract access.
	 *
	 * This mirrors the protected FrontEdit edit/read routes: only a user with
	 * publish or draft access to this exact post may receive UUIDs, block
	 * content, or runtime guidance. Comment-only access is deliberately excluded.
	 *
	 * @param array $input Ability input.
	 * @return bool
	 */
	public function permission_can_edit( $input ): bool {
		$input       = $this->normalize_ability_input( $input );
		$permissions = $this->permissions->get_user_effective_permissions(
			get_current_user_id(),
			(int) ( $input['post_id'] ?? 0 )
		);

		return ! empty( $permissions['can_publish'] ) || ! empty( $permissions['can_draft'] );
	}

	/**
	 * Read the bundled browser runtime contract for the AI-facing discovery ability.
	 *
	 * The Markdown document remains the single source of truth. Returning its
	 * contents avoids maintaining a duplicate PHP list of browser methods that
	 * could drift from the public runtime contract.
	 *
	 * @return array<string,mixed>
	 */
	private function get_frontend_runtime_contract(): array {
		$contract_path = MWPSFE_PLUGIN_DIR . 'docs/frontend-runtime-extension-contract.md';

		if ( ! is_readable( $contract_path ) ) {
			return array(
				'error'  => 'FRONTEND_RUNTIME_CONTRACT_UNAVAILABLE',
				'status' => 500,
			);
		}

		$contract = file_get_contents( $contract_path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads this plugin's bundled canonical contract.
		if ( false === $contract ) {
			return array(
				'error'  => 'FRONTEND_RUNTIME_CONTRACT_UNAVAILABLE',
				'status' => 500,
			);
		}

		return array(
			'contract_version' => 1,
			'namespace'        => 'window.MWP.SFE.PublicApi',
			'runtime_probe'    => 'SFE.PublicApi.getApiInfo()',
			'save_model'       => 'FrontEdit user-driven save flow only; V1 does not expose external direct save.',
			'documentation'    => $contract,
		);
	}

	/**
	 * Normalize array responses into ability-safe payloads.
	 *
	 * @param array<string,mixed> $result Service result.
	 * @return array<string,mixed>|WP_Error
	 */
	private function normalize_execution_result( array $result ) {
		if ( isset( $result['error'] ) ) {
			return new WP_Error(
				'mwpsfe_ability_failed',
				(string) $result['error'],
				array(
					'status' => (int) ( $result['status'] ?? 400 ),
					'data'   => $result,
				)
			);
		}

		return $result;
	}

	/**
	 * Build ability behavior metadata.
	 *
	 * @param bool $readonly    Whether the ability is read-only.
	 * @param bool $idempotent  Whether repeated calls are stable.
	 * @param bool $destructive Whether the ability is destructive.
	 * @return array<string,mixed>
	 */
	private function build_meta( bool $readonly, bool $idempotent, bool $destructive ): array {
		return array(
			'annotations' => array(
				'readonly'    => $readonly,
				'idempotent'  => $idempotent,
				'destructive' => $destructive,
			),
			'show_in_rest' => true,
		);
	}

	/**
	 * Normalize ability callback input across API call sites.
	 *
	 * @param mixed $input Ability input payload.
	 * @return array<string,mixed>
	 */
	private function normalize_ability_input( $input ): array {
		return is_array( $input ) ? $input : array();
	}
}
