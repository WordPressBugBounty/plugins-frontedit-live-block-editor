<?php
namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Shared formatting helpers for values stored by both FrontEdit editions.
 */
class MWPSFE_Date_Utils {

	/**
	 * Format a UTC timestamp using the site's configured date and time formats.
	 *
	 * FrontEdit stores timestamps with current_time( 'timestamp', true ), so
	 * wp_date() must perform the site's timezone conversion exactly once.
	 *
	 * @param int|null $timestamp UTC timestamp, or null for the current time.
	 * @return string Formatted date and time.
	 */
	public static function format_timestamp( $timestamp = null ): string {
		if ( null === $timestamp ) {
			$timestamp = current_time( 'timestamp', true );
		}

		return wp_date(
			get_option( 'date_format', 'F j, Y' ) . ' ' . get_option( 'time_format', 'g:i A' ),
			(int) $timestamp
		);
	}
}
