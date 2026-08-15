<?php
/**
 * FrontEdit - Live Frontend Block Editor
 * 
 * @package   frontedit-live-block-editor
 * @link      https://maintainwp.com
 * @author    MaintainWP
 * @copyright 2026 MaintainWP
 * @license   GPL v2 or later
 *
 * Plugin Name:       FrontEdit - Live Frontend Block Editor
 * Description:       Transform your frontend pages into a lightweight, live block editor. Update text, images, alignment, and more.
 * Version:           1.1.2
 * Plugin URI:        https://maintainwp.com/products/frontedit/
 * Author:            MaintainWP
 * Author URI:        https://maintainwp.com
 * Text Domain:       frontedit-live-block-editor
 * Requires at least: 7.0
 * Requires PHP:      7.4
 * License URI:       https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
 * License:           GPL v2 or later
 */

namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

// ---------------------------------------------------------------------------
// Plugin-wide constants
// ---------------------------------------------------------------------------
// Automatically extract the version from this file's header
$mwpsfe_plugin_data = get_file_data( __FILE__, array( 'Version' => 'Version' ), 'plugin' );

define( 'MWPSFE_PLUGIN_FILE',    __FILE__ );
define( 'MWPSFE_PLUGIN_DIR',     plugin_dir_path( __FILE__ ) );
define( 'MWPSFE_PLUGIN_URL',     plugin_dir_url( __FILE__ ) );
define( 'MWPSFE_PLUGIN_URI',     'https://maintainwp.com/products/frontedit/' );
define( 'MWPSFE_REST_NAMESPACE', 'mwpsfe/v1' );       // REST Route
define( 'MWPSFE_PLUGIN_NAME',    'FrontEdit' );       // Admin menu display name
define( 'MWPSFE_MENU_SLUG',      'mwpsfe-manager' );  // Top-level menu page slug
define( 'MWPSFE_SETTINGS_SLUG',  'mwpsfe-settings' ); // Settings submenu page slug
define( 'MWPSFE_REQUESTS_SLUG',  'mwpsfe-requests' ); // Requests submenu page slug
define( 'MWPSFE_CATALOG_SLUG',   'mwpsfe-catalog' );  // Catalog submenu page slug
define( 'MWPSFE_VERSION',        (string) ( $mwpsfe_plugin_data['Version'] ?? '1.1.2' ) );
define( 'MWPSFE_DB_VERSION',     '1.0' );
define( 'MWPSFE_MIN_WP_VERSION', '7.0' );

require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-pro-integration.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/handlers/core/class-mwpsfe-core-handlers.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-rich-text-editor.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-content-requests.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-date-utils.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-block-renderer.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-block-utils.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-post-content-support.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-admin.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-assets.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-handler-registry.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-uuid-manager.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-post-lock-service.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-operations-service.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-abilities.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-rest-controller.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-permissions.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-manager.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-plugin-lifecycle.php';
require_once MWPSFE_PLUGIN_DIR . 'includes/class-mwpsfe-bootstrap.php';

MWPSFE_Bootstrap::instance()->boot();
