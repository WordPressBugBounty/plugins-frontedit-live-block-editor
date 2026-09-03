<?php
namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Project schema-declared operations into FrontEdit's public operation contract.
 *
 * This class owns the server-side counterpart of `SFE.PublicApi`
 * `getEditOperationContract()`. It exposes only concrete component IDs,
 * handler-declared operation IDs, input requirements, and allowed values. It
 * deliberately excludes attributes, bindings, selectors, executor kinds, and
 * serialization details.
 */
class MWPSFE_Public_Operation_Contract {

	/**
	 * Build the public operation contract for one parsed FrontEdit block.
	 *
	 * @param string                    $uuid    FrontEdit block UUID.
	 * @param array<string,mixed>       $block   Parsed Gutenberg block.
	 * @param MWPSFE_Handler_Interface $handler Resolved FrontEdit edit handler.
	 * @return array<string,mixed>
	 */
	public static function build( string $uuid, array $block, MWPSFE_Handler_Interface $handler ): array {
		if ( ! $handler instanceof MWPSFE_Schema_Handler_Interface ) {
			return array();
		}

		$schema = $handler->get_schema_definition();
		if ( ! is_array( $schema ) || empty( $schema['components'] ) || ! is_array( $schema['components'] ) ) {
			return array();
		}

		$operations = array();
		foreach ( $schema['components'] as $component ) {
			if ( ! is_array( $component ) || ( array_key_exists( 'apiEditable', $component ) && empty( $component['apiEditable'] ) ) ) {
				continue;
			}

			foreach ( self::get_component_ids( $component, $block ) as $component_id ) {
			foreach ( self::get_component_operations( $component, $component_id ) as $operation ) {
					$operations[] = $operation;
				}
			}
		}

		return empty( $operations )
			? array()
			: array(
				'contractVersion' => 1,
				'uuid'            => sanitize_text_field( $uuid ),
				'operations'      => array_values( $operations ),
			);
	}

	/**
	 * Build the handler-derived public state for readable public operations.
	 *
	 * The handler schema is the sole source of truth for this projection. FrontEdit
	 * derives standard operation state from each operation's declared kind, inputs,
	 * component bindings, and attribute capability. A handler may use the private
	 * `currentState` declaration only when its persisted representation needs a
	 * schema-specific reader, such as a table cell's rendered alignment. This
	 * projection deliberately returns only public operation IDs, component IDs,
	 * and public input values; it never exposes block attributes, bindings,
	 * selectors, or executor metadata to an integration consumer.
	 *
	 * @param array<string,mixed>       $block   Parsed Gutenberg block.
	 * @param MWPSFE_Handler_Interface $handler Resolved FrontEdit edit handler.
	 * @return array<int,array<string,mixed>> Public current-operation-state records.
	 */
	public static function build_current_operation_state( array $block, MWPSFE_Handler_Interface $handler ): array {
		if ( ! $handler instanceof MWPSFE_Schema_Handler_Interface ) {
			return array();
		}

		$schema = $handler->get_schema_definition();
		if ( ! is_array( $schema ) || empty( $schema['components'] ) || ! is_array( $schema['components'] ) ) {
			return array();
		}

		$attrs  = isset( $block['attrs'] ) && is_array( $block['attrs'] ) ? $block['attrs'] : array();
		$root   = self::get_block_markup_root( $block );
		$states = array();
		foreach ( $schema['components'] as $component ) {
			if ( ! is_array( $component ) || ( array_key_exists( 'apiEditable', $component ) && empty( $component['apiEditable'] ) ) ) {
				continue;
			}

			$editor = isset( $component['editor'] ) && is_array( $component['editor'] ) ? $component['editor'] : array();
			foreach ( self::get_component_context_records( $component, $block ) as $record ) {
				$component_id = sanitize_key( (string) ( $record['id'] ?? '' ) );
				$context      = isset( $record['context'] ) && is_array( $record['context'] ) ? $record['context'] : array();
				if ( '' === $component_id ) {
					continue;
				}

				foreach ( (array) ( $editor['operations'] ?? array() ) as $operation ) {
					if ( ! is_array( $operation ) || empty( $operation['publicOperation'] ) ) {
						continue;
					}

					$operation_id = sanitize_key( (string) ( $operation['id'] ?? '' ) );
					if ( '' === $operation_id ) {
						continue;
					}

					$state_definitions = self::get_operation_current_state_definitions( $operation );
					if ( empty( $state_definitions ) ) {
						continue;
					}

					$state = self::read_operation_current_state(
						$state_definitions,
						$attrs,
						$root,
						$component,
						$context
					);
					if ( empty( $state ) ) {
						continue;
					}

					$states[] = array(
						'componentId' => $component_id,
						'operationId' => $operation_id,
						'state'       => $state,
					);
				}
			}
		}

		return $states;
	}

	/**
	 * Build concrete runtime component/context records from one schema component.
	 *
	 * This mirrors the existing public-operation component expansion while
	 * retaining repeat values so operation state can read the exact table cell or
	 * other repeated surface declared by the handler.
	 *
	 * @param array<string,mixed> $component Schema component definition.
	 * @param array<string,mixed> $block     Parsed Gutenberg block.
	 * @return array<int,array{id:string,context:array<string,int|string>}>
	 */
	private static function get_component_context_records( array $component, array $block ): array {
		$component_id = sanitize_key( (string) ( $component['id'] ?? '' ) );
		if ( '' === $component_id ) {
			return array();
		}

		if ( empty( $component['repeat'] ) || ! is_array( $component['repeat'] ) ) {
			return array(
				array(
					'id'      => $component_id,
					'context' => array(),
				),
			);
		}

		$path = self::get_context_binding_path( $component );
		if ( '' === $path ) {
			return array();
		}

		$contexts = self::get_binding_contexts(
			isset( $block['attrs'] ) && is_array( $block['attrs'] ) ? $block['attrs'] : array(),
			$path
		);
		if ( empty( $contexts ) ) {
			$contexts = self::get_repeat_contexts_from_markup( $component, $block );
		}

		$records = array();
		foreach ( $contexts as $context ) {
			$runtime_id = self::build_runtime_component_id( $component_id, $context );
			if ( '' !== $runtime_id ) {
				$records[] = array(
					'id'      => $runtime_id,
					'context' => $context,
				);
			}
		}

		return $records;
	}

	/**
	 * Build the state-reader declarations for one public schema operation.
	 *
	 * Standard operation kinds are fully described by their existing handler
	 * schema: the operation inputs identify public values, while the component
	 * bindings and attribute metadata identify where FrontEdit reads the current
	 * value. Handlers only need an explicit `currentState` declaration when that
	 * normal schema data cannot describe the persisted state on its own.
	 *
	 * @param array<string,mixed> $operation Raw handler operation declaration.
	 * @return array<string,array<string,mixed>> State readers keyed by public input name.
	 */
	private static function get_operation_current_state_definitions( array $operation ): array {
		$definitions = self::get_default_operation_current_state_definitions( $operation );
		$overrides   = isset( $operation['currentState'] ) && is_array( $operation['currentState'] )
			? $operation['currentState']
			: array();

		foreach ( $overrides as $input_name => $definition ) {
			$input_name = self::normalize_public_input_name( $input_name );
			if ( '' !== $input_name && is_array( $definition ) ) {
				$definitions[ $input_name ] = $definition;
			}
		}

		return $definitions;
	}

	/**
	 * Derive normal current-state readers from one schema operation declaration.
	 *
	 * This intentionally switches on FrontEdit's generic executor kinds rather
	 * than block names. The declared component and input contract remain the
	 * handler-owned source of truth for every built-in and external handler.
	 *
	 * @param array<string,mixed> $operation Raw handler operation declaration.
	 * @return array<string,array<string,mixed>> State readers keyed by public input name.
	 */
	private static function get_default_operation_current_state_definitions( array $operation ): array {
		$kind   = sanitize_key( (string) ( $operation['kind'] ?? '' ) );
		$inputs = isset( $operation['inputs'] ) && is_array( $operation['inputs'] ) ? $operation['inputs'] : array();

		if ( 'text_rewrite' === $kind && isset( $inputs['runs'] ) ) {
			return array(
				'runs' => array(
					'source' => 'component_content_runs',
				),
			);
		}

		if ( 'replace_component_media' === $kind ) {
			$definitions = array();
			if ( isset( $inputs['url'] ) ) {
				$definitions['url'] = array(
					'source'        => 'component_binding',
					'bindingSource' => 'url',
				);
			}
			if ( isset( $inputs['attachmentId'] ) ) {
				$definitions['attachmentId'] = array(
					'source'        => 'component_binding',
					'bindingSource' => 'id',
				);
			}

			return $definitions;
		}

		if ( 'link_change' === $kind ) {
			$definitions = array();
			if ( isset( $inputs['href'] ) ) {
				$definitions['href'] = array(
					'source'    => 'component_attribute',
					'attribute' => 'href',
				);
			}
			if ( isset( $inputs['new_tab'] ) ) {
				$definitions['new_tab'] = array(
					'source'    => 'component_attribute',
					'attribute' => 'target',
					'default'   => false,
					'transform' => 'equals',
					'value'     => '_blank',
				);
			}
			if ( isset( $inputs['no_follow'] ) ) {
				$definitions['no_follow'] = array(
					'source'    => 'component_attribute',
					'attribute' => 'rel',
					'default'   => false,
					'transform' => 'contains_token',
					'value'     => 'nofollow',
				);
			}

			return $definitions;
		}

		if ( 'block_attribute_change' !== $kind ) {
			return array();
		}

		$definitions = array();
		$attribute   = trim( (string) ( $operation['attribute'] ?? '' ) );
		if ( '' !== $attribute && isset( $inputs['value'] ) ) {
			$definitions['value'] = array(
				'source' => 'block_attribute',
				'path'   => $attribute,
			);
			if ( array_key_exists( 'unsetValue', $operation ) ) {
				$definitions['value']['default'] = $operation['unsetValue'];
			}
		}

		if (
			isset( $inputs['columns'] )
			&& is_array( $inputs['columns'] )
			&& 'zero_based_indexes_or_all' === ( $inputs['columns']['type'] ?? '' )
		) {
			$definitions['columns'] = array(
				'source'  => 'repeat_context',
				'key'     => 'column',
				'asArray' => true,
			);
		}

		return $definitions;
	}

	/**
	 * Read the public state values declared by one handler operation.
	 *
	 * @param array<string,mixed>      $definitions Handler-owned current-state definitions by public input name.
	 * @param array<string,mixed>      $attrs       Parsed current block attributes.
	 * @param \DOMElement|null         $root        Isolated saved-markup root.
	 * @param array<string,mixed>      $component   Schema component definition.
	 * @param array<string,int|string> $context     Concrete repeat context.
	 * @return array<string,mixed> Public input values.
	 */
	private static function read_operation_current_state( array $definitions, array $attrs, ?\DOMElement $root, array $component, array $context ): array {
		$state = array();
		foreach ( $definitions as $input_name => $definition ) {
			$input_name = self::normalize_public_input_name( $input_name );
			if ( '' === $input_name || ! is_array( $definition ) ) {
				continue;
			}

			$value = self::read_operation_current_state_value( $definition, $attrs, $root, $component, $context );
			if ( is_string( $value ) ) {
				$state[ $input_name ] = wp_check_invalid_utf8( $value );
			} elseif ( is_int( $value ) || is_float( $value ) || is_bool( $value ) || null === $value ) {
				$state[ $input_name ] = $value;
			} elseif ( is_array( $value ) && count( $value ) === count( array_filter( $value, 'is_int' ) ) ) {
				$state[ $input_name ] = array_values( $value );
			} elseif ( self::is_rich_text_run_state( $value ) ) {
				$state[ $input_name ] = self::normalize_rich_text_run_state( $value );
			}
		}

		return $state;
	}

	/**
	 * Resolve one handler-declared current-state value from block data or markup.
	 *
	 * @param array<string,mixed>      $definition Handler-owned read definition.
	 * @param array<string,mixed>      $attrs      Parsed current block attributes.
	 * @param \DOMElement|null         $root       Isolated saved-markup root.
	 * @param array<string,mixed>      $component  Schema component definition.
	 * @param array<string,int|string> $context    Concrete repeat context.
	 * @return mixed Public state value.
	 */
	private static function read_operation_current_state_value( array $definition, array $attrs, ?\DOMElement $root, array $component, array $context ) {
		$source = sanitize_key( (string) ( $definition['source'] ?? '' ) );
		$found  = false;
		$value  = null;
		if ( 'block_attribute' === $source ) {
			$value = self::get_array_value_by_path( $attrs, (string) ( $definition['path'] ?? '' ), $found );
		} elseif ( 'component_attribute' === $source ) {
			$element   = self::get_component_markup_element( $root, $component, $context );
			$attribute = trim( (string) ( $definition['attribute'] ?? '' ) );
			if ( $element instanceof \DOMElement && '' !== $attribute && $element->hasAttribute( $attribute ) ) {
				$value = $element->getAttribute( $attribute );
				$found = true;
			}
		} elseif ( 'component_text_alignment' === $source ) {
			$value = self::get_component_text_alignment_state( $root, $component, $context, $found );
		} elseif ( 'component_content_runs' === $source ) {
			$value = self::get_component_content_runs( $attrs, $root, $component, $context, $found );
		} elseif ( 'component_binding' === $source ) {
			$value = self::get_component_binding_value(
				$attrs,
				$component,
				$context,
				sanitize_key( (string) ( $definition['bindingSource'] ?? '' ) ),
				$found
			);
		} elseif ( 'repeat_context' === $source ) {
			$key = sanitize_key( (string) ( $definition['key'] ?? '' ) );
			if ( '' !== $key && array_key_exists( $key, $context ) && is_int( $context[ $key ] ) ) {
				$value = ! empty( $definition['asArray'] ) ? array( $context[ $key ] ) : $context[ $key ];
				$found = true;
			}
		}

		if ( ! $found && array_key_exists( 'default', $definition ) ) {
			$value = $definition['default'];
			$found = true;
		}

		if ( ! $found ) {
			return null;
		}

		$transform = sanitize_key( (string) ( $definition['transform'] ?? '' ) );
		if ( 'equals' === $transform ) {
			return (string) $value === (string) ( $definition['value'] ?? '' );
		}
		if ( 'contains_token' === $transform ) {
			$tokens = preg_split( '/\s+/', trim( (string) $value ) );
			$tokens = is_array( $tokens ) ? $tokens : array();
			return in_array( (string) ( $definition['value'] ?? '' ), $tokens, true );
		}

		return $value;
	}

	/**
	 * Determine whether one state value is a structured rich-text run sequence.
	 *
	 * @param mixed $value Candidate public state value.
	 * @return bool Whether the value has FrontEdit's public run shape.
	 */
	private static function is_rich_text_run_state( $value ): bool {
		if ( ! is_array( $value ) || empty( $value ) ) {
			return false;
		}

		foreach ( $value as $run ) {
			if ( ! is_array( $run ) || ! isset( $run['text'] ) || ! is_string( $run['text'] ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Normalize a rich-text run sequence into FrontEdit's public state shape.
	 *
	 * The reader only projects handler-declared formats and the persisted anchor
	 * attributes required to preserve a formatted range. It never returns raw
	 * markup or arbitrary DOM attributes.
	 *
	 * @param array<int,array<string,mixed>> $runs Candidate run sequence.
	 * @return array<int,array<string,mixed>> Public rich-text runs.
	 */
	private static function normalize_rich_text_run_state( array $runs ): array {
		$normalized = array();
		foreach ( $runs as $run ) {
			$formats = isset( $run['formats'] ) && is_array( $run['formats'] )
				? array_values( array_filter( array_map( 'sanitize_key', $run['formats'] ) ) )
				: array();
			$attributes = isset( $run['formatAttributes'] ) && is_array( $run['formatAttributes'] )
				? $run['formatAttributes']
				: array();

			$normalized[] = array(
				'text'             => wp_check_invalid_utf8( (string) $run['text'] ),
				'formats'          => array_values( array_unique( $formats ) ),
				'formatAttributes' => $attributes,
			);
		}

		return $normalized;
	}

	/**
	 * Read a schema text component's current public rich-text runs.
	 *
	 * Component bindings identify the appropriate text representation. The
	 * component element is preferred when present because it is the concrete
	 * persisted surface for repeated components and root HTML bindings alike.
	 * Attribute bindings provide the same handler-declared value when a component
	 * has no saved markup element, such as an optional missing field.
	 *
	 * @param array<string,mixed>      $attrs     Parsed current block attributes.
	 * @param \DOMElement|null         $root      Isolated saved-markup root.
	 * @param array<string,mixed>      $component Schema component definition.
	 * @param array<string,int|string> $context   Concrete repeat context.
	 * @param bool                     $found     Whether a current component value was found.
	 * @return array<int,array<string,mixed>> Structured public run records.
	 */
	private static function get_component_content_runs( array $attrs, ?\DOMElement $root, array $component, array $context, bool &$found ): array {
		$found   = false;
		$binding = self::get_component_content_binding( $component );
		if ( empty( $binding ) ) {
			return array();
		}

		$source  = sanitize_key( (string) ( $binding['source'] ?? '' ) );
		$element = self::get_component_markup_element( $root, $component, $context );
		$value   = '';
		if ( $element instanceof \DOMElement ) {
			$value = 'plaintext' === $source
				? trim( wp_check_invalid_utf8( (string) $element->textContent ) )
				: self::get_markup_inner_html( $element );
			$found = true;
		} else {
			$value = self::get_component_binding_value( $attrs, $component, $context, $source, $found );
		}

		if ( ! $found ) {
			return array();
		}

		if ( 'plaintext' === $source ) {
			$value = str_replace( array( "\r\n", "\r" ), "\n", (string) $value );
			return '' === $value
				? array()
				: array(
					array(
						'text'             => wp_check_invalid_utf8( $value ),
						'formats'          => array(),
						'formatAttributes' => array(),
					),
				);
		}

		return self::build_component_rich_text_runs( (string) $value, $component );
	}

	/**
	 * Return the text binding that owns a component's readable current content.
	 *
	 * @param array<string,mixed> $component Schema component definition.
	 * @return array<string,mixed> Handler-declared HTML or plaintext binding.
	 */
	private static function get_component_content_binding( array $component ): array {
		foreach ( (array) ( $component['bindings'] ?? array() ) as $binding ) {
			if ( ! is_array( $binding ) ) {
				continue;
			}

			$source = sanitize_key( (string) ( $binding['source'] ?? '' ) );
			if ( in_array( $source, array( 'html', 'plaintext' ), true ) ) {
				return $binding;
			}
		}

		return array();
	}

	/**
	 * Read the first component binding with the requested handler source.
	 *
	 * @param array<string,mixed>      $attrs          Parsed current block attributes.
	 * @param array<string,mixed>      $component      Schema component definition.
	 * @param array<string,int|string> $context        Concrete repeat context.
	 * @param string                   $binding_source Schema binding source to read.
	 * @param bool                     $found          Whether the binding was found.
	 * @return mixed Bound current value.
	 */
	private static function get_component_binding_value( array $attrs, array $component, array $context, string $binding_source, bool &$found ) {
		$found          = false;
		$binding_source = sanitize_key( $binding_source );
		if ( '' === $binding_source ) {
			return null;
		}

		foreach ( (array) ( $component['bindings'] ?? array() ) as $binding ) {
			if ( ! is_array( $binding ) || $binding_source !== sanitize_key( (string) ( $binding['source'] ?? '' ) ) ) {
				continue;
			}

			$path = self::apply_binding_context( (string) ( $binding['path'] ?? '' ), $context );
			if ( '' === $path ) {
				continue;
			}

			$value = self::get_array_value_by_path( $attrs, $path, $found );
			if ( $found ) {
				return $value;
			}
		}

		return null;
	}

	/**
	 * Apply a concrete repeat context to one handler binding path.
	 *
	 * @param string                    $path    Handler binding path template.
	 * @param array<string,int|string>  $context Concrete repeat context.
	 * @return string Context-resolved binding path.
	 */
	private static function apply_binding_context( string $path, array $context ): string {
		$resolved = preg_replace_callback(
			'/\{([A-Za-z0-9_-]+)\}/',
			static function( array $matches ) use ( $context ): string {
				$key = sanitize_key( (string) $matches[1] );
				return array_key_exists( $key, $context ) ? (string) $context[ $key ] : '';
			},
			$path
		);

		return is_string( $resolved ) ? trim( $resolved ) : '';
	}

	/**
	 * Build public rich-text runs from a handler-owned component HTML value.
	 *
	 * @param string              $html      Current component HTML.
	 * @param array<string,mixed> $component Schema component definition.
	 * @return array<int,array<string,mixed>> Structured public run records.
	 */
	private static function build_component_rich_text_runs( string $html, array $component ): array {
		$html = trim( $html );
		if ( '' === $html || ! class_exists( '\\DOMDocument' ) ) {
			return array();
		}

		$tag_map = self::get_component_inline_format_tag_map( $component );
		$document = new \DOMDocument();
		$previous = libxml_use_internal_errors( true );
		$loaded   = $document->loadHTML(
			'<?xml encoding="utf-8" ?><div id="mwpsfe-public-operation-runs">' . $html . '</div>',
			LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
		);
		libxml_clear_errors();
		libxml_use_internal_errors( $previous );
		if ( ! $loaded ) {
			return array();
		}

		$root = $document->getElementById( 'mwpsfe-public-operation-runs' );
		if ( ! $root instanceof \DOMElement ) {
			return array();
		}

		$runs = array();
		self::collect_component_rich_text_runs( $root, array(), array(), $tag_map, $runs );
		return $runs;
	}

	/**
	 * Build a handler inline-format tag-to-token map for rich-text state reads.
	 *
	 * @param array<string,mixed> $component Schema component definition.
	 * @return array<string,array<int,string>> Format tokens keyed by lower-case tag.
	 */
	private static function get_component_inline_format_tag_map( array $component ): array {
		$editor       = isset( $component['editor'] ) && is_array( $component['editor'] ) ? $component['editor'] : array();
		$capabilities = isset( $editor['inlineFormatCapabilities'] ) && is_array( $editor['inlineFormatCapabilities'] )
			? $editor['inlineFormatCapabilities']
			: array();
		$tag_map      = array();

		foreach ( $capabilities as $token => $capability ) {
			$token = sanitize_key( (string) $token );
			$tag   = is_array( $capability ) ? strtolower( trim( (string) ( $capability['tag'] ?? '' ) ) ) : '';
			if ( '' !== $token && 1 === preg_match( '/^[a-z][a-z0-9-]*$/', $tag ) ) {
				$tag_map[ $tag ][] = $token;
			}
		}

		return $tag_map;
	}

	/**
	 * Recursively collect public rich-text runs from one component DOM subtree.
	 *
	 * @param \DOMNode                       $node                     Current DOM node.
	 * @param array<int,string>               $active_formats           Active format tokens.
	 * @param array<string,array<string,string>> $active_format_attributes Active format attributes.
	 * @param array<string,array<int,string>> $tag_map                  Tag-to-token map.
	 * @param array<int,array<string,mixed>>  $runs                     Run collection by reference.
	 * @return void
	 */
	private static function collect_component_rich_text_runs( \DOMNode $node, array $active_formats, array $active_format_attributes, array $tag_map, array &$runs ): void {
		if ( XML_TEXT_NODE === $node->nodeType ) {
			$text = wp_check_invalid_utf8( (string) $node->nodeValue );
			if ( '' !== $text ) {
				self::append_component_rich_text_run( $runs, $text, $active_formats, $active_format_attributes );
			}
			return;
		}

		if ( XML_ELEMENT_NODE === $node->nodeType ) {
			$tag = strtolower( (string) $node->nodeName );
			if ( 'br' === $tag ) {
				self::append_component_rich_text_run( $runs, "\n", array(), array() );
				return;
			}

			foreach ( (array) ( $tag_map[ $tag ] ?? array() ) as $token ) {
				if ( ! in_array( $token, $active_formats, true ) ) {
					$active_formats[] = $token;
				}

				if ( 'a' === $tag && $node instanceof \DOMElement ) {
					$attributes = array();
					foreach ( array( 'href', 'target', 'rel' ) as $attribute ) {
						if ( $node->hasAttribute( $attribute ) ) {
							$value = trim( wp_check_invalid_utf8( (string) $node->getAttribute( $attribute ) ) );
							if ( '' !== $value ) {
								$attributes[ $attribute ] = $value;
							}
						}
					}
					if ( ! empty( $attributes ) ) {
						$active_format_attributes[ $token ] = $attributes;
					}
				}
			}
		}

		foreach ( $node->childNodes as $child ) {
			self::collect_component_rich_text_runs( $child, $active_formats, $active_format_attributes, $tag_map, $runs );
		}
	}

	/**
	 * Append one rich-text state run, merging compatible adjacent runs.
	 *
	 * @param array<int,array<string,mixed>>        $runs              Existing run collection.
	 * @param string                                 $text              Current text fragment.
	 * @param array<int,string>                      $formats           Active format tokens.
	 * @param array<string,array<string,string>>    $format_attributes Active format attributes.
	 * @return void
	 */
	private static function append_component_rich_text_run( array &$runs, string $text, array $formats, array $format_attributes ): void {
		$run = array(
			'text'             => $text,
			'formats'          => array_values( array_unique( array_filter( array_map( 'sanitize_key', $formats ) ) ) ),
			'formatAttributes' => $format_attributes,
		);
		$last_index = count( $runs ) - 1;
		if (
			$last_index >= 0
			&& $runs[ $last_index ]['formats'] === $run['formats']
			&& $runs[ $last_index ]['formatAttributes'] === $run['formatAttributes']
		) {
			$runs[ $last_index ]['text'] .= $run['text'];
			return;
		}

		$runs[] = $run;
	}

	/**
	 * Read FrontEdit's current text-alignment state from a concrete component.
	 *
	 * The handler chooses this source explicitly for virtual component bindings.
	 * It recognizes the same public persisted forms FrontEdit writes: the
	 * cell-level data attribute, utility classes, and inline style declaration.
	 *
	 * @param \DOMElement|null         $root      Isolated saved-markup root.
	 * @param array<string,mixed>      $component Schema component definition.
	 * @param array<string,int|string> $context   Concrete repeat context.
	 * @param bool                     $found     Whether an explicit state was found.
	 * @return string Current text alignment when declared.
	 */
	private static function get_component_text_alignment_state( ?\DOMElement $root, array $component, array $context, bool &$found ): string {
		$found   = false;
		$element = self::get_component_markup_element( $root, $component, $context );
		if ( ! $element instanceof \DOMElement ) {
			return '';
		}

		$data_alignment = strtolower( trim( $element->getAttribute( 'data-align' ) ) );
		if ( in_array( $data_alignment, array( 'left', 'center', 'right', 'justify' ), true ) ) {
			$found = true;
			return $data_alignment;
		}

		$classes = preg_split( '/\s+/', trim( $element->getAttribute( 'class' ) ) );
		$classes = is_array( $classes ) ? $classes : array();
		foreach ( array( 'justify', 'right', 'center', 'left' ) as $alignment ) {
			if ( in_array( 'has-text-align-' . $alignment, $classes, true ) ) {
				$found = true;
				return $alignment;
			}
		}

		if ( preg_match( '/(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\s*(?:;|$)/i', $element->getAttribute( 'style' ), $matches ) ) {
			$found = true;
			return strtolower( (string) $matches[1] );
		}

		return '';
	}

	/**
	 * Return one concrete repeated component element from saved block markup.
	 *
	 * @param \DOMElement|null         $root      Isolated saved-markup root.
	 * @param array<string,mixed>      $component Schema component definition.
	 * @param array<string,int|string> $context   Concrete repeat context.
	 * @return \DOMElement|null Concrete component element.
	 */
	private static function get_component_markup_element( ?\DOMElement $root, array $component, array $context ): ?\DOMElement {
		if ( ! $root instanceof \DOMElement ) {
			return null;
		}

		$repeat = isset( $component['repeat'] ) && is_array( $component['repeat'] ) ? $component['repeat'] : array();
		if ( empty( $repeat ) ) {
			$selector = trim( (string) ( $component['selector'] ?? '' ) );
			if ( ':scope' === $selector ) {
				return self::get_default_markup_content_element( $root );
			}

			$elements = self::find_markup_elements_by_schema_selector( $root, $selector );
			return isset( $elements[0] ) && $elements[0] instanceof \DOMElement ? $elements[0] : null;
		}

		$row_selector  = trim( (string) ( $repeat['rowSelector'] ?? '' ) );
		$cell_selector = trim( (string) ( $repeat['cellSelector'] ?? '' ) );
		$row           = isset( $context['row'] ) && is_int( $context['row'] ) ? $context['row'] : -1;
		$column        = isset( $context['column'] ) && is_int( $context['column'] ) ? $context['column'] : -1;
		if ( '' === $row_selector || '' === $cell_selector || $row < 0 || $column < 0 ) {
			return null;
		}

		$rows = self::find_markup_elements( $root, $row_selector );
		if ( ! isset( $rows[ $row ] ) || ! $rows[ $row ] instanceof \DOMElement ) {
			return null;
		}

		$cells = self::find_direct_markup_children( $rows[ $row ], $cell_selector );
		return isset( $cells[ $column ] ) && $cells[ $column ] instanceof \DOMElement ? $cells[ $column ] : null;
	}

	/**
	 * Return the element containing a root `:scope` component's actual content.
	 *
	 * Gutenberg root blocks normally contain one element. When a handler's root
	 * markup is fragment-shaped, the isolated wrapper itself remains the current
	 * content surface so the reader preserves the complete declared block content.
	 *
	 * @param \DOMElement $root Isolated saved-markup wrapper.
	 * @return \DOMElement Root content element.
	 */
	private static function get_default_markup_content_element( \DOMElement $root ): \DOMElement {
		$elements = array();
		foreach ( $root->childNodes as $child ) {
			if ( $child instanceof \DOMElement ) {
				$elements[] = $child;
			}
		}

		return 1 === count( $elements ) ? $elements[0] : $root;
	}

	/**
	 * Find saved-markup elements through FrontEdit's compact schema selector set.
	 *
	 * This server reader supports handler selectors made from simple tag, class,
	 * ID, `:not(.class)`, descendant, direct-child, and comma alternatives. It
	 * intentionally does not attempt to duplicate a browser CSS selector engine.
	 *
	 * @param \DOMElement $root     Isolated saved-markup root.
	 * @param string      $selector Handler component selector.
	 * @return array<int,\DOMElement> Matching elements in document order.
	 */
	private static function find_markup_elements_by_schema_selector( \DOMElement $root, string $selector ): array {
		$matches = array();
		foreach ( array_filter( array_map( 'trim', explode( ',', $selector ) ) ) as $selector_part ) {
			$steps = self::parse_markup_schema_selector_steps( $selector_part );
			if ( empty( $steps ) ) {
				continue;
			}

			$current = array( $root );
			foreach ( $steps as $step ) {
				$next = array();
				foreach ( $current as $candidate_root ) {
					$candidates = 'child' === $step['combinator']
						? self::get_direct_markup_children( $candidate_root )
						: self::get_markup_descendant_elements( $candidate_root );
					foreach ( $candidates as $candidate ) {
						if ( self::markup_element_matches_simple_selector( $candidate, $step['selector'] ) ) {
							$next[] = $candidate;
						}
					}
				}
				$current = $next;
				if ( empty( $current ) ) {
					break;
				}
			}

			foreach ( $current as $element ) {
				$matches[] = $element;
			}
		}

		$unique_matches = array();
		foreach ( $matches as $match ) {
			$is_duplicate = false;
			foreach ( $unique_matches as $existing_match ) {
				if ( $existing_match->isSameNode( $match ) ) {
					$is_duplicate = true;
					break;
				}
			}
			if ( ! $is_duplicate ) {
				$unique_matches[] = $match;
			}
		}

		return $unique_matches;
	}

	/**
	 * Parse one compact handler selector into traversal steps.
	 *
	 * @param string $selector Handler selector without comma alternatives.
	 * @return array<int,array{combinator:string,selector:string}> Selector steps.
	 */
	private static function parse_markup_schema_selector_steps( string $selector ): array {
		$selector = trim( (string) preg_replace( '/\s*>\s*/', ' > ', $selector ) );
		if ( '' === $selector ) {
			return array();
		}

		$steps      = array();
		$combinator = 'descendant';
		foreach ( preg_split( '/\s+/', $selector ) as $token ) {
			$token = trim( (string) $token );
			if ( '' === $token ) {
				continue;
			}
			if ( '>' === $token ) {
				$combinator = 'child';
				continue;
			}

			$steps[] = array(
				'combinator' => $combinator,
				'selector'   => $token,
			);
			$combinator = 'descendant';
		}

		return $steps;
	}

	/**
	 * Return direct markup element children for one saved-markup element.
	 *
	 * @param \DOMElement $element Current element.
	 * @return array<int,\DOMElement> Direct element children.
	 */
	private static function get_direct_markup_children( \DOMElement $element ): array {
		$children = array();
		foreach ( $element->childNodes as $child ) {
			if ( $child instanceof \DOMElement ) {
				$children[] = $child;
			}
		}

		return $children;
	}

	/**
	 * Return descendant markup elements for one saved-markup element.
	 *
	 * @param \DOMElement $element Current element.
	 * @return array<int,\DOMElement> Descendant elements.
	 */
	private static function get_markup_descendant_elements( \DOMElement $element ): array {
		$descendants = array();
		foreach ( $element->getElementsByTagName( '*' ) as $descendant ) {
			if ( $descendant instanceof \DOMElement ) {
				$descendants[] = $descendant;
			}
		}

		return $descendants;
	}

	/**
	 * Determine whether a markup element matches one compact simple selector.
	 *
	 * @param \DOMElement $element  Candidate element.
	 * @param string      $selector Simple schema selector.
	 * @return bool Whether the element matches.
	 */
	private static function markup_element_matches_simple_selector( \DOMElement $element, string $selector ): bool {
		$selector = trim( $selector );
		$not_class = '';
		if ( preg_match( '/:not\(\.([A-Za-z0-9_-]+)\)$/', $selector, $not_matches ) ) {
			$not_class = (string) $not_matches[1];
			$selector  = preg_replace( '/:not\(\.[A-Za-z0-9_-]+\)$/', '', $selector );
			$selector  = is_string( $selector ) ? $selector : '';
		}

		if ( '*' === $selector ) {
			return '' === $not_class || ! self::markup_element_has_class( $element, $not_class );
		}

		if ( ! preg_match( '/^([A-Za-z][A-Za-z0-9_-]*)?((?:\.[A-Za-z0-9_-]+)*)(?:#([A-Za-z0-9_-]+))?$/', $selector, $matches ) ) {
			return false;
		}

		$tag = isset( $matches[1] ) ? strtolower( (string) $matches[1] ) : '';
		$id  = isset( $matches[3] ) ? (string) $matches[3] : '';
		if ( '' !== $tag && $tag !== strtolower( $element->tagName ) ) {
			return false;
		}
		if ( '' !== $id && $id !== $element->getAttribute( 'id' ) ) {
			return false;
		}
		if ( ! empty( $matches[2] ) ) {
			foreach ( array_filter( explode( '.', ltrim( (string) $matches[2], '.' ) ) ) as $class ) {
				if ( ! self::markup_element_has_class( $element, $class ) ) {
					return false;
				}
			}
		}

		return '' === $not_class || ! self::markup_element_has_class( $element, $not_class );
	}

	/**
	 * Return whether one markup element has a CSS class token.
	 *
	 * @param \DOMElement $element Candidate markup element.
	 * @param string      $class   CSS class token.
	 * @return bool Whether the class is present.
	 */
	private static function markup_element_has_class( \DOMElement $element, string $class ): bool {
		$classes = preg_split( '/\s+/', trim( $element->getAttribute( 'class' ) ) );
		return is_array( $classes ) && in_array( $class, $classes, true );
	}

	/**
	 * Serialize an element's inner HTML from the parsed saved block markup.
	 *
	 * @param \DOMElement $element Component element.
	 * @return string Component inner HTML.
	 */
	private static function get_markup_inner_html( \DOMElement $element ): string {
		$html = '';
		foreach ( $element->childNodes as $child ) {
			$html .= $element->ownerDocument->saveHTML( $child );
		}

		return trim( $html );
	}

	/**
	 * Read a nested current block attribute using a handler-declared path.
	 *
	 * @param array<string,mixed> $attrs Parsed block attributes.
	 * @param string              $path  Dot-delimited handler attribute path.
	 * @param bool                $found Whether every path segment existed.
	 * @return mixed Attribute value when found.
	 */
	private static function get_array_value_by_path( array $attrs, string $path, bool &$found ) {
		$found    = false;
		$segments = array_values( array_filter( array_map( 'trim', explode( '.', $path ) ) ) );
		if ( empty( $segments ) ) {
			return null;
		}

		$value = $attrs;
		foreach ( $segments as $segment ) {
			$key = ctype_digit( $segment ) ? (int) $segment : $segment;
			if ( ! is_array( $value ) || ! array_key_exists( $key, $value ) ) {
				return null;
			}
			$value = $value[ $key ];
		}

		$found = true;
		return $value;
	}

	/**
	 * Return concrete browser-runtime component IDs for one schema component.
	 *
	 * Repeated component IDs use the same `__r#_c#` and `__p#_#` construction
	 * as FrontEdit's schema runtime. Contexts are derived from the handler
	 * binding path and the parsed block's concrete attribute or markup state;
	 * missing repeat contexts result in no public operation rather than an
	 * invented target.
	 *
	 * @param array<string,mixed> $component Schema component definition.
	 * @param array<string,mixed> $block     Parsed Gutenberg block.
	 * @return array<int,string>
	 */
	private static function get_component_ids( array $component, array $block ): array {
		$component_id = sanitize_key( (string) ( $component['id'] ?? '' ) );
		if ( '' === $component_id ) {
			return array();
		}

		if ( empty( $component['repeat'] ) || ! is_array( $component['repeat'] ) ) {
			return array( $component_id );
		}

		$path = self::get_context_binding_path( $component );
		if ( '' === $path ) {
			return array();
		}

		$contexts = self::get_binding_contexts(
			isset( $block['attrs'] ) && is_array( $block['attrs'] ) ? $block['attrs'] : array(),
			$path
		);
		if ( empty( $contexts ) ) {
			$contexts = self::get_repeat_contexts_from_markup( $component, $block );
		}
		$ids      = array();
		foreach ( $contexts as $context ) {
			$runtime_id = self::build_runtime_component_id( $component_id, $context );
			if ( '' !== $runtime_id ) {
				$ids[] = $runtime_id;
			}
		}

		return array_values( array_unique( $ids ) );
	}

	/**
	 * Resolve concrete repeated-component contexts from saved block markup.
	 *
	 * Gutenberg stores several repeated core-block surfaces, including table
	 * cells, as HTML-sourced attributes. Parsed block attributes therefore do
	 * not always contain the handler binding path. The schema repeat definition
	 * is sufficient to inspect the same concrete rows/cells the browser runtime
	 * resolves without exposing selectors or mutation details in the result.
	 *
	 * @param array<string,mixed> $component Schema component definition.
	 * @param array<string,mixed> $block     Parsed Gutenberg block.
	 * @return array<int,array<string,int|string>> Concrete repeat contexts.
	 */
	private static function get_repeat_contexts_from_markup( array $component, array $block ): array {
		$repeat = isset( $component['repeat'] ) && is_array( $component['repeat'] ) ? $component['repeat'] : array();
		$root   = self::get_block_markup_root( $block );
		if ( ! $root instanceof \DOMElement ) {
			return array();
		}

		if ( 'tree_path' === sanitize_key( (string) ( $repeat['mode'] ?? '' ) ) ) {
			return self::get_tree_path_contexts_from_markup( $root, $repeat );
		}

		$row_selector  = trim( (string) ( $repeat['rowSelector'] ?? '' ) );
		$cell_selector = trim( (string) ( $repeat['cellSelector'] ?? '' ) );
		if ( '' === $row_selector || '' === $cell_selector ) {
			return array();
		}

		$contexts = array();
		foreach ( self::find_markup_elements( $root, $row_selector ) as $row_index => $row ) {
			foreach ( self::find_direct_markup_children( $row, $cell_selector ) as $column_index => $cell ) {
				$contexts[] = array(
					'row'    => $row_index,
					'column' => $column_index,
				);
			}
		}

		return $contexts;
	}

	/**
	 * Parse a block's saved inner markup into an isolated DOM root.
	 *
	 * @param array<string,mixed> $block Parsed Gutenberg block.
	 * @return \DOMElement|null Markup root, or null when no markup is available.
	 */
	private static function get_block_markup_root( array $block ): ?\DOMElement {
		$markup = trim( (string) ( $block['innerHTML'] ?? '' ) );
		if ( '' === $markup || ! class_exists( '\\DOMDocument' ) ) {
			return null;
		}

		$document = new \DOMDocument();
		$previous = libxml_use_internal_errors( true );
		$loaded   = $document->loadHTML(
			'<!DOCTYPE html><html><body><div id="mwpsfe-public-operation-root">' . $markup . '</div></body></html>',
			LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
		);
		libxml_clear_errors();
		libxml_use_internal_errors( $previous );
		if ( ! $loaded ) {
			return null;
		}

		$root = $document->getElementById( 'mwpsfe-public-operation-root' );
		return $root instanceof \DOMElement ? $root : null;
	}

	/**
	 * Find markup descendants using the small, tag-only selector subset used by
	 * current schema repeat rows.
	 *
	 * @param \DOMElement $root     Markup root.
	 * @param string      $selector Schema row selector.
	 * @return array<int,\DOMElement> Matched elements in document order.
	 */
	private static function find_markup_elements( \DOMElement $root, string $selector ): array {
		$tags = array_values(
			array_filter(
				array_map( 'strtolower', preg_split( '/\\s+|\\s*>\\s*/', trim( $selector ) ) ?: array() ),
				static function( string $tag ): bool {
					return 1 === preg_match( '/^[a-z][a-z0-9-]*$/', $tag );
				}
			)
		);
		if ( empty( $tags ) ) {
			return array();
		}

		$query = './/' . implode( '//', $tags );
		$xpath = new \DOMXPath( $root->ownerDocument );
		$nodes = $xpath->query( $query, $root );
		if ( ! $nodes instanceof \DOMNodeList ) {
			return array();
		}

		$matches = array();
		foreach ( $nodes as $node ) {
			if ( $node instanceof \DOMElement ) {
				$matches[] = $node;
			}
		}

		return $matches;
	}

	/**
	 * Find direct child elements matching a schema repeat cell selector.
	 *
	 * @param \DOMElement $parent   Row element.
	 * @param string      $selector Schema cell selector.
	 * @return array<int,\DOMElement> Matching direct children in document order.
	 */
	private static function find_direct_markup_children( \DOMElement $parent, string $selector ): array {
		$tag = strtolower( trim( $selector ) );
		if ( 1 !== preg_match( '/^[a-z][a-z0-9-]*$/', $tag ) ) {
			return array();
		}

		$matches = array();
		foreach ( $parent->childNodes as $child ) {
			if ( $child instanceof \DOMElement && strtolower( $child->tagName ) === $tag ) {
				$matches[] = $child;
			}
		}

		return $matches;
	}

	/**
	 * Resolve nested list-item contexts from a tree-path repeat declaration.
	 *
	 * @param \DOMElement         $root   Markup root.
	 * @param array<string,mixed> $repeat Schema repeat definition.
	 * @return array<int,array<string,string>> Concrete path contexts.
	 */
	private static function get_tree_path_contexts_from_markup( \DOMElement $root, array $repeat ): array {
		$item_selector = strtolower( trim( (string) ( $repeat['itemSelector'] ?? '' ) ) );
		$path_key      = sanitize_key( (string) ( $repeat['pathKey'] ?? 'path' ) );
		if ( '' === $item_selector || '' === $path_key || 1 !== preg_match( '/^[a-z][a-z0-9-]*$/', $item_selector ) ) {
			return array();
		}

		$contexts = array();
		foreach ( self::find_markup_elements( $root, $item_selector ) as $item ) {
			$path = self::get_markup_list_item_path( $item, $root );
			if ( '' !== $path ) {
				$contexts[] = array( $path_key => $path );
			}
		}

		return $contexts;
	}

	/**
	 * Build a zero-based underscore-separated list-item path from saved markup.
	 *
	 * @param \DOMElement $item List item element.
	 * @param \DOMElement $root Markup root.
	 * @return string Nested list path.
	 */
	private static function get_markup_list_item_path( \DOMElement $item, \DOMElement $root ): string {
		$parts   = array();
		$current = $item;
		while ( $current instanceof \DOMElement && $current !== $root ) {
			if ( 'li' !== strtolower( $current->tagName ) ) {
				$current = $current->parentNode instanceof \DOMElement ? $current->parentNode : null;
				continue;
			}

			$index = 0;
			for ( $sibling = $current->previousSibling; $sibling instanceof \DOMNode; $sibling = $sibling->previousSibling ) {
				if ( $sibling instanceof \DOMElement && 'li' === strtolower( $sibling->tagName ) ) {
					++$index;
				}
			}
			array_unshift( $parts, (string) $index );

			$parent = $current->parentNode;
			while ( $parent instanceof \DOMElement && 'li' !== strtolower( $parent->tagName ) && $parent !== $root ) {
				$parent = $parent->parentNode;
			}
			$current = $parent instanceof \DOMElement ? $parent : null;
		}

		return empty( $parts ) ? '' : implode( '_', $parts );
	}

	/**
	 * Return the first component binding path that carries repeat tokens.
	 *
	 * @param array<string,mixed> $component Schema component definition.
	 * @return string
	 */
	private static function get_context_binding_path( array $component ): string {
		foreach ( (array) ( $component['bindings'] ?? array() ) as $binding ) {
			if ( ! is_array( $binding ) ) {
				continue;
			}

			$path = trim( (string) ( $binding['path'] ?? '' ) );
			if ( '' !== $path && preg_match( '/\{[A-Za-z0-9_-]+\}/', $path ) ) {
				return $path;
			}
		}

		return '';
	}

	/**
	 * Collect every concrete repeat context represented by a binding path.
	 *
	 * @param array<string,mixed> $attrs Parsed block attributes.
	 * @param string              $path  Context-token binding path.
	 * @return array<int,array<string,int|string>>
	 */
	private static function get_binding_contexts( array $attrs, string $path ): array {
		$segments = array_values(
			array_filter(
				array_map( 'trim', explode( '.', $path ) ),
				static function( string $segment ): bool {
					return '' !== $segment;
				}
			)
		);
		if ( empty( $segments ) ) {
			return array();
		}

		$contexts = array();
		self::collect_binding_contexts( $attrs, $segments, 0, array(), $contexts );
		return array_values( $contexts );
	}

	/**
	 * Recursively collect concrete token values from one parsed attribute tree.
	 *
	 * @param mixed                       $value    Current attribute subtree.
	 * @param array<int,string>           $segments Binding-path segments.
	 * @param int                         $index    Current segment index.
	 * @param array<string,int|string>    $context  Context accumulated so far.
	 * @param array<string,array<string,int|string>> $contexts Dedupe map populated by reference.
	 * @return void
	 */
	private static function collect_binding_contexts( $value, array $segments, int $index, array $context, array &$contexts ): void {
		if ( $index >= count( $segments ) ) {
			ksort( $context );
			$contexts[ (string) wp_json_encode( $context ) ] = $context;
			return;
		}

		if ( ! is_array( $value ) ) {
			return;
		}

		$segment = $segments[ $index ];
		if ( preg_match( '/^\{([A-Za-z0-9_-]+)\}$/', $segment, $matches ) ) {
			$token = sanitize_key( (string) $matches[1] );
			foreach ( $value as $key => $child ) {
				$next_context           = $context;
				$next_context[ $token ] = is_numeric( $key ) ? (int) $key : sanitize_text_field( (string) $key );
				self::collect_binding_contexts( $child, $segments, $index + 1, $next_context, $contexts );
			}
			return;
		}

		$key = ctype_digit( $segment ) ? (int) $segment : $segment;
		if ( array_key_exists( $key, $value ) ) {
			self::collect_binding_contexts( $value[ $key ], $segments, $index + 1, $context, $contexts );
		}
	}

	/**
	 * Build one concrete schema-runtime component ID from a repeat context.
	 *
	 * @param string                    $component_id Base schema component ID.
	 * @param array<string,int|string>  $context      Repeat context.
	 * @return string
	 */
	private static function build_runtime_component_id( string $component_id, array $context ): string {
		if ( isset( $context['path'] ) ) {
			$path = preg_replace( '/[^0-9_]+/', '', (string) $context['path'] );
			if ( is_string( $path ) && '' !== $path ) {
				return sanitize_key( $component_id . '__p' . $path );
			}
		}

		$parts = array();
		if ( isset( $context['row'] ) && is_numeric( $context['row'] ) ) {
			$parts[] = 'r' . (int) $context['row'];
		}
		if ( isset( $context['column'] ) && is_numeric( $context['column'] ) ) {
			$parts[] = 'c' . (int) $context['column'];
		}

		return empty( $parts ) ? '' : sanitize_key( $component_id . '__' . implode( '_', $parts ) );
	}

	/**
	 * Project one component's explicitly public schema operations.
	 *
	 * @param array<string,mixed> $component    Schema component definition.
	 * @param string              $component_id Concrete runtime component ID.
	 * @return array<int,array<string,mixed>>
	 */
	private static function get_component_operations( array $component, string $component_id ): array {
		$editor     = isset( $component['editor'] ) && is_array( $component['editor'] ) ? $component['editor'] : array();
		$operations = array();
		foreach ( (array) ( $editor['operations'] ?? array() ) as $operation ) {
			$projected = self::project_operation( $operation, $component_id, $component );
			if ( ! empty( $projected ) ) {
				$operations[] = $projected;
			}
		}

		return $operations;
	}

	/**
	 * Project one handler-declared public operation without its private metadata.
	 *
	 * @param mixed               $operation    Raw schema operation declaration.
	 * @param string              $component_id Concrete runtime component ID.
	 * @param array<string,mixed> $component    Owning schema component definition.
	 * @return array<string,mixed>
	 */
	private static function project_operation( $operation, string $component_id, array $component ): array {
		if ( ! is_array( $operation ) || empty( $operation['publicOperation'] ) ) {
			return array();
		}

		$id     = sanitize_key( (string) ( $operation['id'] ?? '' ) );
		$inputs = self::project_inputs( isset( $operation['inputs'] ) && is_array( $operation['inputs'] ) ? $operation['inputs'] : array() );
		if ( '' === $id || empty( $inputs ) ) {
			return array();
		}

		$projected = array(
			'id'          => $id,
			'componentId' => $component_id,
			'inputs'      => $inputs,
		);
		if ( isset( $operation['values'] ) && is_array( $operation['values'] ) ) {
			$values = array_values(
				array_filter(
					$operation['values'],
					static function( $value ): bool {
						return is_string( $value ) || is_numeric( $value ) || is_bool( $value ) || null === $value;
					}
				)
			);
			if ( ! empty( $values ) ) {
				$projected['values'] = $values;
			}
		}
		if ( self::operation_accepts_rich_text_runs( $inputs ) ) {
			$projected['allowedRunFormats'] = self::get_component_run_format_tokens( $component );
			$required_format_attributes     = self::get_component_required_run_format_attributes( $component );
			if ( ! empty( $required_format_attributes ) ) {
				$projected['requiredRunFormatAttributes'] = $required_format_attributes;
			}
		}

		return $projected;
	}

	/**
	 * Determine whether a public operation accepts structured rich-text runs.
	 *
	 * @param array<string,array<string,mixed>> $inputs Public input definitions.
	 * @return bool Whether the operation accepts rich-text runs.
	 */
	private static function operation_accepts_rich_text_runs( array $inputs ): bool {
		foreach ( $inputs as $input ) {
			if ( is_array( $input ) && 'rich_text_runs' === ( $input['type'] ?? '' ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Project the handler-declared inline format tokens usable in text runs.
	 *
	 * This intentionally exposes tokens, not tags, bindings, or renderer
	 * details. Required format attributes are projected separately when they are
	 * necessary to construct a valid rich-text run.
	 *
	 * @param array<string,mixed> $component Owning schema component definition.
	 * @return array<int,string> Supported public format tokens.
	 */
	private static function get_component_run_format_tokens( array $component ): array {
		$editor       = isset( $component['editor'] ) && is_array( $component['editor'] ) ? $component['editor'] : array();
		$capabilities = isset( $editor['inlineFormatCapabilities'] ) && is_array( $editor['inlineFormatCapabilities'] )
			? $editor['inlineFormatCapabilities']
			: array();

		return array_values(
			array_unique(
				array_filter(
					array_map( 'sanitize_key', array_keys( $capabilities ) )
				)
			)
		);
	}

	/**
	 * Project the minimum handler-declared attributes required by rich-text formats.
	 *
	 * The output is public operation data, not a projection of FrontEdit's full
	 * inline capability metadata. It lets an integration preserve a valid format
	 * without exposing selectors, renderer tags, or optional implementation data.
	 *
	 * @param array<string,mixed> $component Owning schema component definition.
	 * @return array<string,array<int,string>> Required attributes keyed by format token.
	 */
	private static function get_component_required_run_format_attributes( array $component ): array {
		$editor       = isset( $component['editor'] ) && is_array( $component['editor'] ) ? $component['editor'] : array();
		$capabilities = isset( $editor['inlineFormatCapabilities'] ) && is_array( $editor['inlineFormatCapabilities'] )
			? $editor['inlineFormatCapabilities']
			: array();
		$requirements = array();

		foreach ( $capabilities as $format => $capability ) {
			$format = sanitize_key( (string) $format );
			if ( '' === $format || ! is_array( $capability ) ) {
				continue;
			}

			$attributes = array_values(
				array_filter(
					array_map( 'sanitize_key', (array) ( $capability['requiredAttributes'] ?? array() ) )
				)
			);
			if ( ! empty( $attributes ) ) {
				$requirements[ $format ] = array_values( array_unique( $attributes ) );
			}
		}

		return $requirements;
	}

	/**
	 * Project the public input requirements for one handler operation.
	 *
	 * @param array<string,mixed> $inputs Raw schema input map.
	 * @return array<string,array<string,mixed>>
	 */
	private static function project_inputs( array $inputs ): array {
		$projected = array();
		foreach ( $inputs as $name => $definition ) {
			$name = self::normalize_public_input_name( $name );
			$type = is_array( $definition ) ? sanitize_key( (string) ( $definition['type'] ?? '' ) ) : '';
			if ( '' === $name || ! in_array( $type, array( 'scalar', 'zero_based_indexes_or_all', 'rich_text_runs', 'url' ), true ) ) {
				return array();
			}

			$projected[ $name ] = array(
				'type'     => $type,
				'required' => ! empty( $definition['required'] ),
			);
		}

		return $projected;
	}

	/**
	 * Validate one handler-declared public operation input name without changing it.
	 *
	 * Public operation input names are protocol keys. They may use camel case,
	 * such as `attachmentId`, so WordPress's lowercase-oriented sanitize_key()
	 * must not be applied to them. The schema and browser public API share these
	 * exact names.
	 *
	 * @param mixed $name Candidate handler-declared input name.
	 * @return string Exact valid public input name, or an empty string.
	 */
	private static function normalize_public_input_name( $name ): string {
		$name = trim( (string) $name );
		return 1 === preg_match( '/^[A-Za-z][A-Za-z0-9_]*$/', $name ) ? $name : '';
	}
}
