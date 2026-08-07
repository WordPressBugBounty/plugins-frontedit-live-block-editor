<?php
namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Return whether a separately installed Pro add-on has enabled its features.
 *
 * The free package deliberately owns no license key, validation, remote call,
 * or entitlement state. Pro supplies this answer through the filter after its
 * own entitlement service has loaded.
 *
 * @return bool Whether Pro features are active for this installation.
 */
function mwpsfe_is_pro_active(): bool {
	return (bool) apply_filters( 'mwpsfe_is_pro_active', false );
}

/**
 * Return whether the separate Pro bootstrap is loaded.
 *
 * @return bool Whether the Pro add-on is available in this request.
 */
function mwpsfepro_class_exists(): bool {
	return class_exists( 'MWPSFEPRO\\MWPSFEPRO_Bootstrap' );
}
