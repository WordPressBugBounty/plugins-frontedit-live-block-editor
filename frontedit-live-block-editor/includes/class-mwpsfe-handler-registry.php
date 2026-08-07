<?php
namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_Handler_Registry {

	private static $instance;
	private $handlers = array();
	private $loaded_external_files = array();

	/**
	 * Get singleton instance of the Handler Registry
	 * 
	 * This ensures only one instance of the Handler Registry exists throughout the WordPress lifecycle.
	 * The instance is initialized on first call and cached for subsequent calls.
	 * 
	 * @return MWPSFE_Handler_Registry The singleton instance
	 */
	public static function instance() {
		if ( ! self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Initialize the Handler Registry and register all hooks
	 * 
	 * This method sets up all WordPress hooks, filters, and initializes subsystems.
	 * It handles:
	 * - Handler registration via filter system
	 * 
	 * Called automatically by instance() method.
	 * 
	 * @return void
	 */
	public function init() {
		add_filter( 'mwpsfe_manager_register_handlers', array( $this, 'default_register_handlers' ) );

		$this->register_handlers_from_filter();
		$this->register_handlers_from_external_files_filter();
	}

	/**
	 * Register default handlers for WordPress core blocks
	 * 
	 * This method is called via the 'mwpsfe_manager_register_handlers' filter and
	 * registers all built-in core block handlers. Companion capabilities (like
	 * comment handlers) are resolved directly from each core handler via
	 * get_comment_handler() during registration.
	 * 
	 * Third-party code can add additional handlers by filtering this same hook.
	 * 
	 * @param array $handlers Existing handlers array (from previous filters)
	 * @return array Updated handlers array with default handlers added
	 */
	public function default_register_handlers( $handlers ) {
		$ns = __NAMESPACE__ . '\\';

		// WordPress Core Blocks
		$handlers['core_paragraph']         = array( 'class' => $ns . 'MWPSFE_Handler_Core_Paragraph' );
		$handlers['core_heading']           = array( 'class' => $ns . 'MWPSFE_Handler_Core_Heading' );
		$handlers['core_list']              = array( 'class' => $ns . 'MWPSFE_Handler_Core_List' );
		$handlers['core_code']              = array( 'class' => $ns . 'MWPSFE_Handler_Core_Code' );
		$handlers['core_details']           = array( 'class' => $ns . 'MWPSFE_Handler_Core_Details' );
		$handlers['core_preformatted']      = array( 'class' => $ns . 'MWPSFE_Handler_Core_Preformatted' );
		$handlers['core_pullquote']         = array( 'class' => $ns . 'MWPSFE_Handler_Core_Pullquote' );
		$handlers['core_table']             = array( 'class' => $ns . 'MWPSFE_Handler_Core_Table' );
		$handlers['core_verse']             = array( 'class' => $ns . 'MWPSFE_Handler_Core_Verse' );
		$handlers['core_image']             = array( 'class' => $ns . 'MWPSFE_Handler_Core_Image' );
		$handlers['core_audio']             = array( 'class' => $ns . 'MWPSFE_Handler_Core_Audio' );
		$handlers['core_cover']             = array( 'class' => $ns . 'MWPSFE_Handler_Core_Cover' );
		$handlers['core_file']              = array( 'class' => $ns . 'MWPSFE_Handler_Core_File' );
		$handlers['core_media_text']        = array( 'class' => $ns . 'MWPSFE_Handler_Core_Media_Text' );
		$handlers['core_video']             = array( 'class' => $ns . 'MWPSFE_Handler_Core_Video' );
		$handlers['core_icon']              = array( 'class' => $ns . 'MWPSFE_Handler_Core_Icon' );
		$handlers['core_accordion_heading'] = array( 'class' => $ns . 'MWPSFE_Handler_Core_Accordion_Heading' );
		$handlers['core_button']            = array( 'class' => $ns . 'MWPSFE_Handler_Core_Button' );

		return $handlers;
	}

	/**
	 * Register handlers from the filter system
	 * 
	 * This method applies the 'mwpsfe_manager_register_handlers' filter and instantiates
	 * all registered handler classes. It supports two registration methods:
	 * 1. Direct class registration: ['class' => 'ClassName'] if class already loaded
	 * 2. File + class registration: ['class_file' => 'path', 'class' => 'ClassName']
	 * 
	 * Core handlers (capability=edit) are always the registration entry point.
	 * Companion handlers (comment capability) are resolved from each core handler's
	 * get_comment_handler() method and registered automatically.
	 * 
	 * @return void
	 */
	private function register_handlers_from_filter() {
		$registered = apply_filters( 'mwpsfe_manager_register_handlers', array() );
		foreach ( $registered as $id => $info ) {
			$handler = $this->instantiate_handler_from_registration( $info );
			if ( ! $handler ) {
				continue;
			}

			$this->register_handler_with_companions( $handler );
		}
	}

	/**
	 * Register external handler classes from a dedicated file-path filter.
	 *
	 * External plugins provide one or more handler file paths through the
	 * `mwpsfe_external_handler_files` filter. This keeps ownership of custom
	 * handler files entirely inside the third-party plugin instead of requiring any
	 * file placement inside the FrontEdit plugin directory.
	 *
	 * @return void
	 */
	private function register_handlers_from_external_files_filter() {
		$files = apply_filters( 'mwpsfe_external_handler_files', array() );
		foreach ( $this->normalize_external_handler_files( $files ) as $file ) {
			$this->register_handlers_from_external_file( $file );
		}
	}

	/**
	 * Normalize external handler file paths supplied through the filter.
	 *
	 * Invalid or empty values are ignored. Duplicate paths are removed while
	 * preserving order so later registrations remain deterministic.
	 *
	 * @param mixed $files Filter-supplied file paths.
	 * @return array<int, string>
	 */
	private function normalize_external_handler_files( $files ) {
		$normalized = array();

		foreach ( (array) $files as $file ) {
			$file = wp_normalize_path( trim( (string) $file ) );
			if ( '' !== $file ) {
				$normalized[] = $file;
			}
		}

		return array_values( array_unique( $normalized ) );
	}

	/**
	 * Load one external handler file and register any handlers it contributes.
	 *
	 * A file may contribute handlers in either of these formats:
	 * - Define one or more edit-handler classes directly.
	 * - Return a registration array matching the core filter contract.
	 *
	 * Direct class discovery keeps the onboarding path friendly for developers who
	 * want to paste in a normal handler class without extra registration glue.
	 *
	 * @param string $file Absolute file path.
	 * @return void
	 */
	private function register_handlers_from_external_file( $file ) {
		$file = wp_normalize_path( (string) $file );
		if ( '' === $file || ! is_readable( $file ) || isset( $this->loaded_external_files[ $file ] ) ) {
			return;
		}

		$declared_before = get_declared_classes();
		$returned_value  = require_once $file;
		$declared_after  = get_declared_classes();

		$this->loaded_external_files[ $file ] = true;

		$new_classes = array_values( array_diff( $declared_after, $declared_before ) );
		foreach ( $new_classes as $class_name ) {
			$handler = $this->instantiate_external_handler_class( $class_name );
			if ( $handler ) {
				$this->register_handler_with_companions( $handler );
			}
		}

		if ( is_array( $returned_value ) ) {
			foreach ( $returned_value as $registration ) {
				$handler = $this->instantiate_handler_from_registration( $registration );
				if ( $handler ) {
					$this->register_handler_with_companions( $handler );
				}
			}
		}
	}

	/**
	 * Instantiate one edit handler class discovered from an external file.
	 *
	 * External drop-in files are allowed to define comment handlers too, but only
	 * edit handlers are instantiated directly. Companion comment handlers continue
	 * to flow through get_comment_handler() just like core classes.
	 *
	 * @param string $class_name Fully-qualified class name.
	 * @return MWPSFE_Handler_Interface|null
	 */
	private function instantiate_external_handler_class( $class_name ) {
		return $this->instantiate_handler_class( $class_name );
	}

	/**
	 * Instantiate one handler from registration metadata.
	 *
	 * @param array $info Registration array.
	 * @return MWPSFE_Handler_Interface|null
	 */
	private function instantiate_handler_from_registration( $info ) {
		if ( ! is_array( $info ) ) {
			return null;
		}

		if ( isset( $info['class_file'] ) && is_string( $info['class_file'] ) && file_exists( $info['class_file'] ) ) {
			require_once( $info['class_file'] );
		}

		return isset( $info['class'] ) ? $this->instantiate_handler_class( $info['class'] ) : null;
	}

	/**
	 * Instantiate a handler class after validating its interface and constructor.
	 *
	 * Handler registrations are extension points, so invalid classes must be
	 * ignored before construction rather than causing a fatal error during plugin
	 * initialization. Handler constructors may still execute when the class is
	 * valid and has no required constructor parameters.
	 *
	 * @param mixed $class_name Fully-qualified handler class name.
	 * @return MWPSFE_Handler_Interface|null
	 */
	private function instantiate_handler_class( $class_name ) {
		$class_name = is_string( $class_name ) ? ltrim( $class_name, '\\' ) : '';
		if ( '' === $class_name || ! class_exists( $class_name ) ) {
			return null;
		}

		if ( ! is_subclass_of( $class_name, MWPSFE_Handler_Interface::class ) ) {
			return null;
		}

		$reflection = new \ReflectionClass( $class_name );
		if ( ! $reflection->isInstantiable() ) {
			return null;
		}

		$constructor = $reflection->getConstructor();
		if ( $constructor && $constructor->getNumberOfRequiredParameters() > 0 ) {
			return null;
		}

		$handler = $reflection->newInstance();

		return ( $handler instanceof MWPSFE_Handler_Interface ) ? $handler : null;
	}

	/**
	 * Register one edit handler and its companion comment handler, if available.
	 *
	 * Handler registration remains edit-first. Comment handlers are derived from
	 * the edit handler's get_comment_handler() implementation to preserve the
	 * existing architecture for drafts, requests, history, and save flow.
	 *
	 * @param MWPSFE_Handler_Interface $handler Handler instance to register.
	 * @return void
	 */
	private function register_handler_with_companions( MWPSFE_Handler_Interface $handler ) {
		if ( $handler->capability() !== 'edit' ) {
			return;
		}

		$this->register_handler( $handler );

		$comment_handler = $handler->get_comment_handler();
		if (
			$comment_handler instanceof MWPSFE_Handler_Interface &&
			$comment_handler->capability() === 'comment'
		) {
			$this->register_handler( $comment_handler );
		}
	}

	/**
	 * Register a single handler instance
	 * 
	 * Adds a handler to the internal handlers array, indexed by the handler's ID.
	 * Each handler ID must be unique. If a handler with the same ID already exists,
	 * it will be overwritten.
	 * 
	 * @param MWPSFE_Handler_Interface $handler The handler instance to register
	 * @return void
	 */
	public function register_handler( MWPSFE_Handler_Interface $handler ) {
		$this->handlers[ $handler->id() ] = $handler;
	}

	/**
	 * Get list of all handlers formatted for frontend consumption
	 * 
	 * This method transforms the internal handlers array into a format suitable
	 * for JavaScript consumption. Each handler is serialized with:
	 * - Basic info: id, title, description, capability, priority
	 * - Action labels and button text
	 * - Content type and element type code
	 * - Client configuration: schema editable component definitions
	 * 
	 * The returned array is typically passed to the frontend via wp_localize_script.
	 * 
	 * @return array Array of handler configurations ready for JSON encoding
	 */
	public function handlers_list() {
		$out = array();
		foreach ( $this->handlers as $id => $h ) {
			$editable_components = method_exists( $h, 'get_editable_components' )
				? (array) $h->get_editable_components()
				: array();

			$config = array(
				'id'                     => $h->id(),
				'title'                  => $h->title(),
				'description'            => $h->description(),
				'capability'             => $h->capability(),
				'actionLabel'            => $h->title(),
				'buttonLabel'            => $h->action_label(),
				'contentType'            => $h->content_type(),
				'elementType'            => $h->element_type(),
				'elementTypeCode'        => $h->element_type_code(),
				'priority'               => (int) $h->priority(),
				'client_config'          => array(
					'editableComponents' => $editable_components,
				),
			);
			$out[] = $config;
		}
		return $out;
	}

	/**
	 * Get a specific handler by ID
	 * 
	 * @param string $id The handler ID (e.g., 'core_paragraph', 'comment_heading')
	 * @return MWPSFE_Handler_Interface|null The handler instance or null if not found
	 */
	public function get_handler( $id ) {
		return isset( $this->handlers[ $id ] ) ? $this->handlers[ $id ] : null;
	}

	/**
	 * Get all registered handlers
	 * 
	 * Returns the raw handlers array with handler IDs as keys and handler instances as values.
	 * 
	 * @return array Associative array of handler_id => handler_instance
	 */
	public function get_handlers() {
		return $this->handlers;
	}

	/**
	 * Resolve the human-readable element type label for a block name.
	 *
	 * Handler metadata remains the source of truth for block-type labels.
	 *
	 * @param string $block_name Block name like core/paragraph.
	 * @return string
	 */
	public function get_element_type_label_for_block_name( $block_name ) {
		$block_name = trim( (string) $block_name );
		if ( '' === $block_name ) {
			return 'Element';
		}

		foreach ( $this->handlers as $handler ) {
			if ( ! $handler instanceof MWPSFE_Handler_Interface ) {
				continue;
			}

			if ( $handler->capability() !== 'edit' ) {
				continue;
			}

			$supported_blocks = $handler->get_supported_blocks();
			if ( is_array( $supported_blocks ) && in_array( $block_name, $supported_blocks, true ) ) {
				$element_type = trim( (string) $handler->element_type() );
				if ( '' !== $element_type ) {
					return $element_type;
				}
			}
		}

		$label = str_replace( array( 'core/', '-' ), array( '', ' ' ), $block_name );
		$label = ucwords( trim( $label ) );

		return '' !== $label ? $label : 'Element';
	}
}
