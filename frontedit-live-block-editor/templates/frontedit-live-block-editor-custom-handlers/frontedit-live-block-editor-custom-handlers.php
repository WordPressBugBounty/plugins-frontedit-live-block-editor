<?php
/**
 * Plugin Name:       FrontEdit Custom Handlers
 * Description:       Example bootstrap for loading custom FrontEdit handlers from your own plugin.
 * Version:           1.0.0
 * Requires at least: 7.0
 * Requires PHP:      7.4
 */

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Register one external FrontEdit handler file from this custom plugin.
 *
 * Copy this file into your own plugin folder and keep the `handlers` folder
 * beside it. FrontEdit will load the returned handler file after its built-in
 * handlers, which lets your plugin add new handlers or intentionally override
 * an existing handler ID.
 *
 * @param array $files Existing external handler files.
 * @return array
 */
function mwpsfe_custom_handlers_register_files( $files ) {
	$files[] = plugin_dir_path( __FILE__ ) . 'handlers/custom-frontedit-handlers.php';

	return $files;
}

add_filter( 'mwpsfe_external_handler_files', 'mwpsfe_custom_handlers_register_files' );