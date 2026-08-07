<?php
namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_Plugin_Lifecycle {

	private static $hooks_registered = false;
	private static $notice_rendered  = false;

	/**
	 * Determine whether the plugin can boot on this request.
	 *
	 * @return bool
	 */
	public static function can_boot(): bool {
		if ( self::meets_platform_requirements() ) {
			return true;
		}

		if ( is_admin() && ! self::$notice_rendered ) {
			self::$notice_rendered = true;
			add_action( 'admin_notices', array( __CLASS__, 'render_platform_notice' ) );
		}

		return false;
	}

	/**
	 * Register plugin lifecycle hooks and plugin-action links.
	 *
	 * @return void
	 */
	public static function register_hooks(): void {
		if ( self::$hooks_registered ) {
			return;
		}

		self::$hooks_registered = true;

		// Add Settings link on Plugins page.
		add_filter( 'plugin_action_links_' . plugin_basename( MWPSFE_PLUGIN_FILE ), __NAMESPACE__ . '\\mwpsfe_add_settings_link' );

		// Register activation hook.
		register_activation_hook( MWPSFE_PLUGIN_FILE, __NAMESPACE__ . '\\mwpsfe_manager_activate' );
	}

	/**
	 * Run plugin activation logic.
	 *
	 * @return void
	 */
	public static function activate(): void {
		if ( ! self::meets_platform_requirements() ) {
			if ( ! function_exists( 'deactivate_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			deactivate_plugins( plugin_basename( MWPSFE_PLUGIN_FILE ) );

			wp_die(
				esc_html__( 'FrontEdit requires WordPress 7.0 or later with the WordPress abilities API available.', 'frontedit-live-block-editor' ),
				esc_html__( 'Plugin dependency check failed', 'frontedit-live-block-editor' ),
				array( 'back_link' => true )
			);
		}

		/**
		 * Fires when the plugin is activated.
		 * Pro modules hook here to perform first-run initialization.
		 *
		 * The free plugin has no ticket table. The separately packaged Pro add-on
		 * provisions its request/history storage when it is activated.
		 */
		do_action( 'mwpsfe_activate' );
	}

	/**
	 * Check whether the current WordPress runtime satisfies the plugin baseline.
	 *
	 * @return bool
	 */
	public static function meets_platform_requirements(): bool {
		global $wp_version;

		$version_ok  = isset( $wp_version ) && version_compare( (string) $wp_version, MWPSFE_MIN_WP_VERSION, '>=' );
		$abilities_ok = function_exists( 'wp_register_ability' ) && function_exists( 'wp_get_ability' );

		return $version_ok && $abilities_ok;
	}

	/**
	 * Render the admin notice shown when the site is below the new baseline.
	 *
	 * @return void
	 */
	public static function render_platform_notice(): void {
		if ( ! current_user_can( 'activate_plugins' ) ) {
			return;
		}

		echo '<div class="notice notice-error"><p><strong>FrontEdit:</strong> WordPress 7.0 or later with the abilities API is required to boot this version of the plugin.</p></div>';
	}
}

/**
 * Add plugin Settings link on the Plugins screen.
 *
 * @param array $links Existing plugin action links.
 * @return array
 */
function mwpsfe_add_settings_link( $links ) {
	$settings_link = '<a href="' . esc_url( admin_url( 'admin.php?page=' . MWPSFE_SETTINGS_SLUG ) ) . '">Settings</a>';
	array_unshift( $links, $settings_link );
	return $links;
}

/**
 * Plugin activation callback.
 *
 * Fires the 'mwpsfe_activate' action so pro modules can perform
 * their own activation work (e.g. seeding initial history) without
 * this function knowing anything about them.
 */
function mwpsfe_manager_activate() {
	MWPSFE_Plugin_Lifecycle::activate();
}
