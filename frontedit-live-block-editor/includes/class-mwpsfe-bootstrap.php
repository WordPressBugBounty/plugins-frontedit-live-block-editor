<?php
namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_Bootstrap {

	private static $instance = null;
	private $booted = false;

	/**
	 * Get singleton bootstrap instance.
	 *
	 * @return MWPSFE_Bootstrap
	 */
	public static function instance(): MWPSFE_Bootstrap {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	private function __construct() {}

	/**
	 * Boot plugin modules and manager.
	 *
	 * @return void
	 */
	public function boot(): void {
		if ( $this->booted ) {
			return;
		}

		$this->booted = true;

		MWPSFE_Plugin_Lifecycle::register_hooks();

		if ( ! MWPSFE_Plugin_Lifecycle::can_boot() ) {
			return;
		}

		// Boot.
		MWPSFE_Manager::instance();
	}
}
