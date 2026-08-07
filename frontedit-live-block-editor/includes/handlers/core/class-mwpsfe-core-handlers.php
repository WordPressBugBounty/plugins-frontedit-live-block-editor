<?php
/**
 * Handler Interface and Implementations
 * 
 * @package MWPSFE_Manager
 */

namespace MWPSFE;

use DOMDocument;
use DOMXPath;

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Handler Interface
 */
interface MWPSFE_Handler_Interface {
	public function id();
	public function title();
	public function content_type();
	public function container_type();
	public function element_type();
	public function element_type_code();
	public function description();
	public function call_to_action();
	public function capability(); // Returns 'comment' or 'edit'
	public function action_label(); // Label for the button/tab
	public function get_supported_blocks();
	public function priority();
	public function get_comment_handler(); // Returns companion comment handler for core/edit handlers

	// For edit capability only
	public function can_handle_block( $block );
	public function generate_preview( $edit_content, $block, $context = array() );
	public function apply_edit( $post, $element_id, $edit_content );
	public function get_media_tag(); // Returns tag name (img, audio, video, a) or null for text
	public function get_media_attr(); // Returns attribute name (src, href) or null
	public function get_media_zone_selector(); // Returns CSS selector scoping the media element, or null
	public function get_block_url_attr(); // Returns block attribute key holding the media URL, or null
	
	// New methods for handler-specific block updating
	public function update_block_content( &$block, $new_content, $original_attrs );
	public function extract_content_from_html( $html );
}

/**
 * Abstract base class for COMMENT handlers
 * Owns the workflow - child handlers provide specifics
 */
abstract class MWPSFE_Abstract_Comment_Handler implements MWPSFE_Handler_Interface {

	public function capability()     { return 'comment'; }
	public function action_label()   { return 'Comment'; }
	public function priority()       { return 20; }
	public function title()          { return 'Add Comment'; }
	public function container_type() { return null; }

	public function get_supported_blocks()     { return array(); }
	public function get_comment_handler()      { return null; }
	public function can_handle_block( $block ) {
		return isset( $block['blockName'] ) && in_array( $block['blockName'], $this->get_supported_blocks(), true );
	}
	public function generate_preview( $edit_content, $block, $context = array() ) { return ''; }
	public function get_media_tag()            { return null; }
	public function get_media_attr()           { return null; }
	public function get_media_zone_selector()  { return null; }
	public function get_block_url_attr()       { return null; }

	public function apply_edit( $post, $element_id, $edit_content ) {
		return array(
			'status'  => 'error',
			'message' => 'Comment handlers cannot edit'
		);
	}

	// Default implementations for new interface methods
	public function update_block_content( &$block, $new_content, $original_attrs ) {
		// Comment handlers don't update blocks
		return false;
	}

	public function extract_content_from_html( $html ) {
		// Default: just strip tags for text
		return wp_strip_all_tags( $html );
	}
}

/**
 * Intermediate for Text comments
 */
abstract class MWPSFE_Abstract_Text_Comment_Handler extends MWPSFE_Abstract_Comment_Handler {
	public function content_type() { return 'text'; }
}

/**
 * Intermediate for Media comments
 */
abstract class MWPSFE_Abstract_Media_Comment_Handler extends MWPSFE_Abstract_Comment_Handler {
	public function content_type() { return 'media'; }
}

/**
 * Intermediate for Container comments
 */
abstract class MWPSFE_Abstract_Container_Comment_Handler extends MWPSFE_Abstract_Comment_Handler {
	public function container_type() { return 'pure'; }
}

/**
 * Comment on Paragraph Handler
 */
class MWPSFE_Handler_Comment_Core_Paragraph extends MWPSFE_Abstract_Text_Comment_Handler {

	public function id()                { return 'comment_paragraph'; }
	public function element_type()      { return 'Paragraph'; }
	public function element_type_code() { return 'paragraph'; }
	public function description()       { return 'Comment on this paragraph.'; }
	public function call_to_action()    { return 'Click to add a comment for this paragraph.'; }

	public function get_supported_blocks() {
		return array( 'core/paragraph' );
	}
}

/**
 * Comment on Heading Handler
 */
class MWPSFE_Handler_Comment_Core_Heading extends MWPSFE_Abstract_Text_Comment_Handler {

	public function id()                { return 'comment_heading'; }
	public function element_type()      { return 'Heading'; }
	public function element_type_code() { return 'heading'; }
	public function description()       { return 'Comment on this heading.'; }
	public function call_to_action()    { return 'Click to add a comment for this heading.'; }

	public function get_supported_blocks() {
		return array( 'core/heading' );
	}
}

/**
 * Comment on List Handler
 */
class MWPSFE_Handler_Comment_Core_List extends MWPSFE_Abstract_Text_Comment_Handler {

	public function id()                { return 'comment_list'; }
	public function element_type()      { return 'List'; }
	public function element_type_code() { return 'list'; }
	public function description()       { return 'Comment on this list.'; }
	public function call_to_action()    { return 'Click to add a comment for this list.'; }

	public function get_supported_blocks() {
		return array( 'core/list' );
	}
}

/**
 * Comment on Code Handler
 */
class MWPSFE_Handler_Comment_Core_Code extends MWPSFE_Abstract_Text_Comment_Handler {

	public function id()                { return 'comment_code'; }
	public function element_type()      { return 'Code'; }
	public function element_type_code() { return 'code'; }
	public function description()       { return 'Comment on this code block.'; }
	public function call_to_action()    { return 'Click to add a comment for this code.'; }

	public function get_supported_blocks() {
		return array( 'core/code' );
	}
}

/**
 * Comment on Preformatted Handler
 */
class MWPSFE_Handler_Comment_Core_Preformatted extends MWPSFE_Abstract_Text_Comment_Handler {

	public function id()                { return 'comment_preformatted'; }
	public function element_type()      { return 'Preformatted'; }
	public function element_type_code() { return 'preformatted'; }
	public function description()       { return 'Comment on this preformatted block.'; }
	public function call_to_action()    { return 'Click to add a comment for this preformatted text.'; }

	public function get_supported_blocks() {
		return array( 'core/preformatted' );
	}
}

/**
 * Comment on Verse Handler
 */
class MWPSFE_Handler_Comment_Core_Verse extends MWPSFE_Abstract_Text_Comment_Handler {

	public function id()                { return 'comment_verse'; }
	public function element_type()      { return 'Verse'; }
	public function element_type_code() { return 'verse'; }
	public function description()       { return 'Comment on this verse block.'; }
	public function call_to_action()    { return 'Click to add a comment for this verse.'; }

	public function get_supported_blocks() {
		return array( 'core/verse' );
	}
}

/**
 * Comment on Accordion Heading Handler
 */
class MWPSFE_Handler_Comment_Core_Accordion_Heading extends MWPSFE_Abstract_Text_Comment_Handler {

	public function id()                { return 'comment_accordion_heading'; }
	public function element_type()      { return 'Accordion Heading'; }
	public function element_type_code() { return 'accordion-heading'; }
	public function description()       { return 'Comment on this heading.'; }
	public function call_to_action()    { return 'Click to add a comment for this accordion.'; }

	public function get_supported_blocks() {
		return array( 'core/accordion-heading' );
	}
}

/**
 * Comment on Button Handler
 */
class MWPSFE_Handler_Comment_Core_Button extends MWPSFE_Abstract_Text_Comment_Handler {

	public function id()                { return 'comment_button'; }
	public function element_type()      { return 'Button'; }
	public function element_type_code() { return 'button'; }
	public function description()       { return 'Comment on this button.'; }
	public function call_to_action()    { return 'Click to add a comment for this button.'; }

	public function get_supported_blocks() {
		return array( 'core/button' );
	}
}

/**
 * Comment on Pullquote Handler
 */
class MWPSFE_Handler_Comment_Core_Pullquote extends MWPSFE_Abstract_Text_Comment_Handler {

	public function id()                { return 'comment_pullquote'; }
	public function element_type()      { return 'Pullquote'; }
	public function element_type_code() { return 'pullquote'; }
	public function description()       { return 'Comment on this pullquote.'; }
	public function call_to_action()    { return 'Click to add a comment for this pullquote.'; }

	public function get_supported_blocks() {
		return array( 'core/pullquote' );
	}
}

/**
 * Comment on Details Handler
 */
class MWPSFE_Handler_Comment_Core_Details extends MWPSFE_Abstract_Container_Comment_Handler {

	public function id()                { return 'comment_details'; }
	public function content_type()      { return 'text'; }
	public function element_type()      { return 'Details'; }
	public function element_type_code() { return 'details'; }
	public function description()       { return 'Comment on this details block.'; }
	public function call_to_action()    { return 'Click to add a comment for this details block.'; }

	public function get_supported_blocks() {
		return array( 'core/details' );
	}
}

/**
 * Comment on Table Handler
 */

class MWPSFE_Handler_Comment_Core_Table extends MWPSFE_Abstract_Text_Comment_Handler {

	public function id()                { return 'comment_table'; }
	public function element_type()      { return 'Table'; }
	public function element_type_code() { return 'table'; }
	public function description()       { return 'Comment on this table.'; }
	public function call_to_action()    { return 'Click to add a comment for this table.'; }

	public function get_supported_blocks() {
		return array( 'core/table' );
	}
}

/**
 * Comment on Image Handler
 */
class MWPSFE_Handler_Comment_Core_Image extends MWPSFE_Abstract_Media_Comment_Handler {

	public function id()                { return 'comment_image'; }
	public function element_type()      { return 'Image'; }
	public function element_type_code() { return 'img'; }
	public function description()       { return 'Comment on this image.'; }
	public function call_to_action()    { return 'Click to add a comment for this image.'; }

	public function get_supported_blocks() {
		return array( 'core/image' );
	}
}

/**
 * Comment on Icon Handler.
 */
class MWPSFE_Handler_Comment_Core_Icon extends MWPSFE_Abstract_Media_Comment_Handler {

	public function id()                { return 'comment_icon'; }
	public function element_type()      { return 'Icon'; }
	public function element_type_code() { return 'icon'; }
	public function description()       { return 'Comment on this icon.'; }
	public function call_to_action()    { return 'Click to add a comment for this icon.'; }

	public function get_supported_blocks() {
		return array( 'core/icon' );
	}
}

/**
 * Comment on Audio Handler
 */
class MWPSFE_Handler_Comment_Core_Audio extends MWPSFE_Abstract_Media_Comment_Handler {

	public function id()                { return 'comment_audio'; }
	public function element_type()      { return 'Audio'; }
	public function element_type_code() { return 'audio'; }
	public function description()       { return 'Comment on this audio.'; }
	public function call_to_action()    { return 'Click to add a comment for this audio.'; }

	public function get_supported_blocks() {
		return array( 'core/audio' );
	}
}

/**
 * Comment on Video Handler
 */
class MWPSFE_Handler_Comment_Core_Video extends MWPSFE_Abstract_Media_Comment_Handler {

	public function id()                { return 'comment_video'; }
	public function element_type()      { return 'Video'; }
	public function element_type_code() { return 'video'; }
	public function description()       { return 'Comment on this video.'; }
	public function call_to_action()    { return 'Click to add a comment for this video.'; }

	public function get_supported_blocks() {
		return array( 'core/video' );
	}
}

/**
 * Comment on File Handler
 */
class MWPSFE_Handler_Comment_Core_File extends MWPSFE_Abstract_Media_Comment_Handler {

	public function id()                { return 'comment_file'; }
	public function element_type()      { return 'File'; }
	public function element_type_code() { return 'file'; }
	public function description()       { return 'Comment on this file.'; }
	public function call_to_action()    { return 'Click to add a comment for this file.'; }

	public function get_supported_blocks() {
		return array( 'core/file' );
	}
}

/**
 * Comment on Cover Handler
 */
class MWPSFE_Handler_Comment_Core_Cover extends MWPSFE_Abstract_Container_Comment_Handler {

	public function id()                { return 'comment_cover'; }
	public function content_type()      { return 'media'; }
	public function element_type()      { return 'Cover'; }
	public function element_type_code() { return 'cover'; }
	public function description()       { return 'Comment on this cover.'; }
	public function call_to_action()    { return 'Click to add a comment for this cover.'; }

	public function get_supported_blocks() {
		return array( 'core/cover' );
	}
}

/**
 * Comment on Media-Text Handler
 */
class MWPSFE_Handler_Comment_Core_Media_Text extends MWPSFE_Abstract_Container_Comment_Handler {

	public function id()                { return 'comment_media_text'; }
	public function content_type()      { return 'media'; }
	public function element_type()      { return 'Media & Text'; }
	public function element_type_code() { return 'media-text'; }
	public function description()       { return 'Comment on this media-text block.'; }
	public function call_to_action()    { return 'Click to add a comment for this media-text.'; }

	public function get_supported_blocks() {
		return array( 'core/media-text' );
	}
}

/**
 * Abstract base class for EDIT handlers
 * Owns the workflow - child handlers provide specifics
 */
abstract class MWPSFE_Abstract_Edit_Handler implements MWPSFE_Handler_Interface {

	public function priority()          { return 10; }
	public function capability()        { return 'edit'; }
	public function action_label()      { return 'Edit'; }
	public function container_type()    { return null; }
	abstract public function get_comment_handler();
	
	// Default for non-media handlers
	public function get_media_tag()           { return null; }
	public function get_media_attr()          { return null; }
	public function get_media_zone_selector() { return null; }
	public function get_block_url_attr()      { return null; }
	public function get_editable_components() { return array(); }

	// Returns all HTML tags that can carry the media URL in the rendered block markup.
	public function get_media_tags(): array {
		$tag = $this->get_media_tag();
		return $tag !== null ? [ $tag ] : [];
	}

	/**
	 * Universal block content update via raw WP block markup.
	 *
	 * All edit handlers receive a { _type: 'raw_block_content', rawContent: '...' }
	 * payload from the JS buildBlockPayload(). PHP's parse_blocks() decodes it into
	 * a canonical block structure where sourced attrs live in HTML and stored attrs
	 * live in the comment delimiter - exactly matching what the block editor produces.
	 *
	 * Child classes should NOT override this unless they have a genuinely different
	 * wire format (none of the built-in handlers do).
	 */
	public function update_block_content( &$block, $new_content, $original_attrs ) {
		$payload = json_decode( $new_content, true );

		if ( ! $payload || ! is_array( $payload ) || ( $payload['_type'] ?? '' ) !== 'raw_block_content' ) {
			// Invalid payload shape for schema-driven raw block updates.
			return false;
		}

		$raw = $payload['rawContent'] ?? '';
		if ( empty( trim( $raw ) ) ) {
			// Empty raw content cannot be parsed into a valid block.
			return false;
		}

		$parsed_blocks = parse_blocks( $raw );
		$parsed_block  = null;
		foreach ( $parsed_blocks as $b ) {
			if ( ! empty( $b['blockName'] ) ) {
				$parsed_block = $b;
				break;
			}
		}

		if ( ! $parsed_block ) {
			// Parsed payload did not contain a usable block.
			return false;
		}

		if ( $block['blockName'] !== $parsed_block['blockName'] ) {
			// Guard against applying content for a different block type.
			return false;
		}

		$uuid = $block['attrs']['mwpSfeUuidShadow'] ?? ( $block['attrs']['mwpSfeUuid'] ?? '' );

		// Re-insert UUID attrs at the FRONT of the attrs array.
		$new_attrs = $parsed_block['attrs'] ?? [];
		unset( $new_attrs['mwpSfeUuid'], $new_attrs['mwpSfeUuidShadow'] );
		$block['attrs'] = array_merge(
			array( 'mwpSfeUuid' => $uuid, 'mwpSfeUuidShadow' => $uuid ),
			$new_attrs
		);
		$block['innerBlocks']  = $parsed_block['innerBlocks']  ?? [];
		$block['innerContent'] = $parsed_block['innerContent'] ?? [];
		$block['innerHTML']    = $parsed_block['innerHTML']    ?? '';

		if ( empty( $block['innerContent'] ) && ! empty( $block['innerHTML'] ) ) {
			$block['innerContent'] = [ $block['innerHTML'] ];
		}

		return true;
	}

	/**
	 * Logic consolidated: Now child classes just define supported blocks.
	 */
	public function can_handle_block( $block ) {
		if ( ! isset( $block['blockName'] ) || ! in_array( $block['blockName'], $this->get_supported_blocks(), true ) ) {
			return false;
		}

		return $this->validate_block_content( $block );
	}

	/**
	 * Hook for content-specific validation (e.g., text formatting checks)
	 */
	protected function validate_block_content( $block ) {
		return true; 
	}

	/**
	 * Shared preview generator - sanitizes and returns the submitted content.
	 * DO NOT override unless absolutely required
	 */
	public function generate_preview( $edit_content, $block, $context = array() ) {
		$clean_content = MWPSFE_Rich_Text_Editor::sanitize_rich_text( $edit_content );
		return $this->sanitize_generated_content( $clean_content );
	}

	/**
	 * Sanitize generated content before updating the block
	 * JSON handlers: receive JSON structure, handled by update_block_content
	 * Media handlers: override to sanitize URLs with esc_url_raw
	 */
	protected function sanitize_generated_content( $suggestion ) {
		// Base implementation: pass-through (no sanitization)
		return $suggestion;
	}

	/**
	 * Return canonical inline format metadata for schema contracts.
	 *
	 * @param array $format_tokens Inline format tokens exposed by the schema editor.
	 * @return array
	 */
	protected function get_inline_format_capabilities( $format_tokens ) {
		$definitions = array(
			'bold'          => array( 'tag' => 'strong' ),
			'italic'        => array( 'tag' => 'em' ),
			'strikethrough' => array( 'tag' => 's' ),
			'link'          => array(
				'tag'                       => 'a',
				'attributes'                => array( 'href', 'target', 'rel' ),
				'requiredAttributes'        => array( 'href' ),
				'allowedTargets'            => array( '_blank' ),
				'allowedRelTokens'          => array( 'nofollow', 'noopener', 'noreferrer' ),
				'allowedProtocols'          => array( 'http', 'https', 'mailto', 'tel' ),
				'allowsRelativeUrls'        => true,
				'allowsAnchorLinks'         => true,
				'autoProtocol'              => 'https',
				'preservesUnknownRelTokens' => true,
			),
			'buttonLink' => array(
				'tag'                       => 'a',
				'attributes'                => array( 'href', 'target', 'rel' ),
				'requiredAttributes'        => array( 'href' ),
				'allowedTargets'            => array( '_blank' ),
				'allowedRelTokens'          => array( 'nofollow', 'noopener', 'noreferrer' ),
				'allowedProtocols'          => array( 'http', 'https', 'mailto', 'tel' ),
				'allowsRelativeUrls'        => true,
				'allowsAnchorLinks'         => true,
				'autoProtocol'              => 'https',
				'preservesUnknownRelTokens' => true,
			),
		);

		$capabilities = array();
		foreach ( (array) $format_tokens as $token ) {
			$token = is_string( $token ) ? trim( $token ) : '';
			if ( $token && isset( $definitions[ $token ] ) ) {
				$capabilities[ $token ] = $definitions[ $token ];
			}
		}

		return $capabilities;
	}

	/**
	 * Normalize a component editor operation list.
	 *
	 * Filters out invalid placeholders so schema declarations can compose helper
	 * results without extra guard conditionals in every handler.
	 *
	 * @param array $operations Raw operation definitions.
	 * @return array<int, array>
	 */
	protected function normalize_editor_operations( $operations ) {
		$normalized = array_values(
			array_filter(
				(array) $operations,
				static function( $operation ) {
					if ( ! is_array( $operation ) ) {
						return false;
					}

					$operation_id   = isset( $operation['id'] ) ? trim( (string) $operation['id'] ) : '';
					$operation_kind = isset( $operation['kind'] ) ? trim( (string) $operation['kind'] ) : '';

					return '' !== $operation_id && '' !== $operation_kind;
				}
			)
		);

		return $normalized;
	}

	/**
	 * Build a schema operation for text rewrites on one component surface.
	 *
	 * @param string $component_id Component ID that owns the text surface.
	 * @return array<string, mixed>
	 */
	protected function get_editor_text_rewrite_operation( $component_id ) {
		$component_id = trim( (string) $component_id );
		if ( '' === $component_id ) {
			return array();
		}

		return array(
			'id'                     => 'rewrite_text',
			'kind'                   => 'text_rewrite',
			'component'              => $component_id,
			'preserveInlineFormatting' => true,
			'preserveUnchangedText'  => true,
		);
	}

	/**
	 * Build a schema operation for toggling inline formats within one component.
	 *
	 * @param string $component_id Component ID that owns the text surface.
	 * @param array  $format_tokens Inline format tokens that may be toggled.
	 * @param array  $target_modes Supported target resolution modes.
	 * @return array<string, mixed>
	 */
	protected function get_editor_inline_format_change_operation( $component_id, $format_tokens, $target_modes = array( 'specific_target', 'editorial_target' ) ) {
		$component_id = trim( (string) $component_id );
		if ( '' === $component_id ) {
			return array();
		}

		$formats = array_values(
			array_filter(
				array_map(
					static function( $token ) {
						return is_string( $token ) ? trim( $token ) : '';
					},
					(array) $format_tokens
				)
			)
		);

		if ( empty( $formats ) ) {
			return array();
		}

		$modes = array_values(
			array_filter(
				array_map(
					static function( $mode ) {
						return is_string( $mode ) ? trim( $mode ) : '';
					},
					(array) $target_modes
				)
			)
		);

		return array(
			'id'          => 'toggle_inline_format',
			'kind'        => 'inline_format_change',
			'component'   => $component_id,
			'formats'     => $formats,
			'targetModes' => ! empty( $modes ) ? $modes : array( 'specific_target', 'editorial_target' ),
		);
	}

	/**
	 * Build a schema operation for editing inline link-like attributes.
	 *
	 * Capability metadata remains the source of truth for validation; this helper
	 * only exposes the permitted edit surface and preservation behavior.
	 *
	 * @param string $component_id              Component ID that owns the text surface.
	 * @param string $format_token              Inline format token carrying attributes.
	 * @param array  $inline_format_capabilities Available inline capability map.
	 * @param array  $target_modes              Supported target resolution modes.
	 * @return array<string, mixed>
	 */
	protected function get_editor_inline_attribute_change_operation( $component_id, $format_token, $inline_format_capabilities, $target_modes = array( 'specific_target', 'editorial_target' ) ) {
		$component_id = trim( (string) $component_id );
		$format_token = trim( (string) $format_token );
		if ( '' === $component_id || '' === $format_token ) {
			return array();
		}

		$capability = isset( $inline_format_capabilities[ $format_token ] ) && is_array( $inline_format_capabilities[ $format_token ] )
			? $inline_format_capabilities[ $format_token ]
			: array();

		$attributes = array_values(
			array_filter(
				array_map(
					static function( $attribute ) {
						return is_string( $attribute ) ? trim( $attribute ) : '';
					},
					(array) ( $capability['attributes'] ?? array() )
				)
			)
		);

		if ( empty( $attributes ) ) {
			return array();
		}

		$modes = array_values(
			array_filter(
				array_map(
					static function( $mode ) {
						return is_string( $mode ) ? trim( $mode ) : '';
					},
					(array) $target_modes
				)
			)
		);

		$operation = array(
			'id'                            => 'edit_link_attributes',
			'kind'                          => 'inline_attribute_change',
			'component'                     => $component_id,
			'format'                        => $format_token,
			'attributes'                    => $attributes,
			'targetModes'                   => ! empty( $modes ) ? $modes : array( 'specific_target', 'editorial_target' ),
			'preserveUnspecifiedAttributes' => true,
		);

		if ( in_array( 'rel', $attributes, true ) ) {
			$operation['mergeRelTokens'] = true;
		}

		return $operation;
	}

	/**
	 * Build a schema operation for changing one host-level link surface.
	 *
	 * This is intended for components whose editable root element is itself the
	 * canonical anchor, such as `core/button`. Unlike inline attribute changes,
	 * this operation does not rely on text-range targeting.
	 *
	 * @param string $operation_id               Stable operation identifier.
	 * @param string $component_id               Component ID that owns the link surface.
	 * @param string $format_token               Inline capability token describing the anchor semantics.
	 * @param array  $inline_format_capabilities Available inline capability map.
	 * @return array<string, mixed>
	 */
	protected function get_editor_link_change_operation( $operation_id, $component_id, $format_token, $inline_format_capabilities ) {
		$operation_id = trim( (string) $operation_id );
		$component_id = trim( (string) $component_id );
		$format_token = trim( (string) $format_token );
		if ( '' === $operation_id || '' === $component_id || '' === $format_token ) {
			return array();
		}

		$capability = isset( $inline_format_capabilities[ $format_token ] ) && is_array( $inline_format_capabilities[ $format_token ] )
			? $inline_format_capabilities[ $format_token ]
			: array();
		$tag        = isset( $capability['tag'] ) && is_string( $capability['tag'] )
			? strtolower( trim( $capability['tag'] ) )
			: '';
		if ( 'a' !== $tag ) {
			return array();
		}

		$attributes = array_values(
			array_filter(
				array_map(
					static function( $attribute ) {
						return is_string( $attribute ) ? trim( $attribute ) : '';
					},
					(array) ( $capability['attributes'] ?? array() )
				)
			)
		);

		if ( empty( $attributes ) ) {
			return array();
		}

		$operation = array(
			'id'                            => $operation_id,
			'kind'                          => 'link_change',
			'component'                     => $component_id,
			'format'                        => $format_token,
			'attributes'                    => $attributes,
			'settings'                      => array( 'new_tab', 'no_follow' ),
			'targetModes'                   => array( 'host' ),
			'preserveUnspecifiedAttributes' => true,
		);

		if ( in_array( 'rel', $attributes, true ) ) {
			$operation['mergeRelTokens'] = true;
		}

		return $operation;
	}

	/**
	 * Build a schema operation for changing a block-backed attribute capability.
	 *
	 * The capability definition remains authoritative for allowed values; this
	 * operation mirrors the exposed mutation shape so external tooling can reason
	 * about permitted edits without handler-specific logic.
	 *
	 * @param string $operation_id        Stable operation identifier.
	 * @param string $component_id        Component ID that owns the editing surface.
	 * @param array  $attribute_capability Attribute capability definition.
	 * @return array<string, mixed>
	 */
	protected function get_editor_block_attribute_change_operation( $operation_id, $component_id, $attribute_capability ) {
		$operation_id = trim( (string) $operation_id );
		$component_id = trim( (string) $component_id );
		if ( '' === $operation_id || '' === $component_id || ! is_array( $attribute_capability ) ) {
			return array();
		}

		$operation = array(
			'id'        => $operation_id,
			'kind'      => 'block_attribute_change',
			'component' => $component_id,
		);

		if ( ! empty( $attribute_capability['attribute'] ) && is_string( $attribute_capability['attribute'] ) ) {
			$operation['attribute'] = trim( $attribute_capability['attribute'] );
		} elseif ( ! empty( $attribute_capability['attributes'] ) && is_array( $attribute_capability['attributes'] ) ) {
			$operation['attributes'] = array_values(
				array_filter(
					array_map(
						static function( $attribute ) {
							return is_string( $attribute ) ? trim( $attribute ) : '';
						},
						$attribute_capability['attributes']
					)
				)
			);
		}

		if ( empty( $operation['attribute'] ) && empty( $operation['attributes'] ) ) {
			return array();
		}

		if ( isset( $attribute_capability['values'] ) && is_array( $attribute_capability['values'] ) ) {
			$operation['values'] = array_values( $attribute_capability['values'] );
		}

		if ( ! empty( $attribute_capability['tagChange'] ) ) {
			$operation['tagChange'] = true;
		}

		if ( array_key_exists( 'unsetValue', $attribute_capability ) ) {
			$operation['unsetValue'] = $attribute_capability['unsetValue'];
		}

		return $operation;
	}

	/**
	 * Build a schema operation for structural list-tree mutations.
	 *
	 * These operations do not expose a scalar block attribute or inline format.
	 * Instead, they advertise that one component surface participates in
	 * structure-aware DOM mutations such as insert/delete/indent/outdent/move.
	 *
	 * @param string $operation_id Stable operation identifier.
	 * @param string $component_id Component ID that owns the tree surface.
	 * @param string $operation_kind Structural list operation kind.
	 * @return array<string, mixed>
	 */
	protected function get_editor_list_structure_operation( $operation_id, $component_id, $operation_kind ) {
		$operation_id = trim( (string) $operation_id );
		$component_id = trim( (string) $component_id );
		$operation_kind = trim( (string) $operation_kind );
		$supported_kinds = array(
			'insert_list_item',
			'remove_list_item',
			'move_list_item',
			'indent_list_item',
			'outdent_list_item',
			'update_list_item_text',
			'toggle_list_type',
		);

		if (
			'' === $operation_id
			|| '' === $component_id
			|| ! in_array( $operation_kind, $supported_kinds, true )
		) {
			return array();
		}

		return array(
			'id'        => $operation_id,
			'kind'      => $operation_kind,
			'component' => $component_id,
		);
	}

	/**
	 * Shared apply logic
	 */
	public function apply_edit( $post, $element_id, $edit_content ) {
		$blocks       = parse_blocks( $post->post_content );
		$target_block = MWPSFE_Block_Utils::find_block_by_uuid( $blocks, $element_id );

		if ( ! $target_block ) {
			return array(
				'status'  => 'error',
				'message' => 'Block not found with UUID: ' . $element_id
			);
		}

		// Store original attributes before any changes
		$original_attrs = $target_block['attrs'] ?? array();

		$success = MWPSFE_Block_Utils::update_block_by_uuid(
			$blocks,
			$element_id,
			$edit_content,
			$this,
			$original_attrs
		);

		if ( ! $success ) {
			return array(
				'status'  => 'error',
				'message' => 'Failed to update block with UUID: ' . $element_id
			);
		}

		$updated_block = MWPSFE_Block_Utils::find_block_by_uuid( $blocks, $element_id );
		$after_html    = $updated_block['innerHTML'] ?? '';

		// Suppress auto-record hook - we record history explicitly below.
		MWPSFE_Manager::$suppress_history_auto_record = true;
		$res = wp_update_post( array(
			'ID'           => $post->ID,
			'post_content' => wp_slash( serialize_blocks( $blocks ) ),
		) );
		MWPSFE_Manager::$suppress_history_auto_record = false;

		if ( ! is_wp_error( $res ) ) {
			$before_serialized = serialize_blocks( array( $target_block ) );
			$after_serialized  = serialize_blocks( array( $updated_block ) );

			/**
			 * Fires after a block edit has been saved to the database.
			 *
			 * Pro catalog hooks here to record the change in version history.
			 * Free installations have no listener; the action is a no-op for them.
			 *
			 * @param int    $post_id           The post ID.
			 * @param string $element_id        The block UUID.
			 * @param string $before_serialized Serialized block markup before the edit.
			 * @param string $after_serialized  Serialized block markup after the edit.
			 * @param string $new_content       The new content string.
			 * @param string $handler_id        The handler ID that performed the save.
			 */
			do_action(
				'mwpsfe_block_saved',
				$post->ID,
				$element_id,
				$before_serialized,
				$after_serialized,
				$edit_content,
				$this->id()
			);

			return array( 'status' => 'success' );
		}

		return array( 'status' => 'error' );
	}
	
	/**
	 * Extract clean text content from HTML
	 * 
	 * @param string $html The HTML to extract content from
	 * @return string Clean text content
	 */
	public function extract_content_from_html( $html ) {
		// Regular text content
		$text = wp_strip_all_tags( $html );
		return trim( preg_replace( '/\s+/', ' ', $text ) );
	}
}

/**
 * Optional interface for edit handlers that expose a declarative schema.
 */
interface MWPSFE_Schema_Handler_Interface {
	/**
	 * Return a schema contract consumed by the schema runtime in JS.
	 *
	 * Schema shape:
	 * - version (int)
	 * - block (array{name: string, type: string})
	 * - identity (array{pristineDefaultInnerHTML?: string})
	 * - components (array<array>)
	 *
	 * Component editor shape:
	 * - enterMode (string)
	 * - linkUIMode (string)
	 * - tabMode (array)
	 * - formats (array)
	 * - formatTargets (array)
	 * - inlineFormatCapabilities (array<string, array>)
	 * - attributeCapabilities (array<string, array>)
	 * - operations (array<int, array>)
	 *
	 * inlineFormatCapabilities maps an inline format token to the canonical tag
	 * and supported link semantics that format produces so external tooling can
	 * emit schema-compatible markup without handler-specific knowledge.
	 *
	 * Supported inline capability keys:
	 * - tag (string): canonical HTML tag used by the inline format.
	 * - attributes (array<string>): supported HTML attributes for the format tag.
	 * - requiredAttributes (array<string>): attributes that must be present.
	 * - allowedTargets (array<string>): supported target attribute values.
	 * - allowedRelTokens (array<string>): rel tokens directly managed by the UI.
	 * - allowedProtocols (array<string>): supported absolute URL schemes.
	 * - allowsRelativeUrls (bool): whether root-relative URLs are accepted.
	 * - allowsAnchorLinks (bool): whether fragment-only links are accepted.
	 * - autoProtocol (string): scheme prefixed onto bare hostnames by the editor.
	 * - preservesUnknownRelTokens (bool): whether unmanaged rel tokens survive edits.
	 *
	 * attributeCapabilities maps a format token to the block attribute or
	 * attributes that format mutates so external tooling can reason about
	 * schema-driven block updates without hard-coded handler knowledge.
	 *
	 * Supported capability keys:
	 * - attribute (string): single block attribute updated by the format. May be
	 *   a top-level attr key or a dotted nested path such as
	 *   `style.typography.textAlign`.
	 * - attributes (array<string>): multiple block attributes updated together.
	 * - values (array): allowed explicit values when applicable.
	 * - unsetValue (scalar|null): value that represents the default/unset state.
	 *
	 * operations organizes the legal edit actions against those capabilities so
	 * external tooling can understand which mutations are supported on a given
	 * component surface without encoding block-specific knowledge.
	 *
	 * Supported operation keys:
	 * - id (string): stable operation identifier.
	 * - kind (string): operation category such as text_rewrite, link_change, or block_attribute_change.
	 *   Structural list handlers may additionally expose
	 *   `insert_list_item`, `remove_list_item`, `move_list_item`,
	 *   `indent_list_item`, `outdent_list_item`, `update_list_item_text`, or `toggle_list_type`.
	 * - component (string): component ID the operation applies to.
	 * - attribute (string): block-backed attribute changed by the operation.
	 * - attributes (array<string>): multiple block-backed attributes changed together.
	 * - values (array): explicit values exposed for block attribute changes.
	 * - unsetValue (scalar|null): default or unset value for block attribute changes.
	 * - formats (array<string>): inline format tokens the operation may toggle.
	 * - format (string): inline format token carrying editable attributes.
	 * - targetModes (array<string>): supported targeting modes for inline or host-link edits.
	 * - preserveInlineFormatting (bool): whether rewrites preserve existing inline tags.
	 * - preserveUnchangedText (bool): whether unchanged text should survive rewrites.
	 * - preserveUnspecifiedAttributes (bool): whether omitted inline attrs are retained.
	 * - mergeRelTokens (bool): whether rel tokens are merged instead of replaced outright.
	 *
	 * @return array
	 */
	public function get_schema_definition();
}

/**
 * Abstract base class for text handlers
 */
abstract class MWPSFE_Abstract_Text_Edit_Handler extends MWPSFE_Abstract_Edit_Handler {
	public function content_type() { return 'text'; }

	/**
	 * JSON handlers receive a structured block payload from the frontend, not freeform text.
	 * Returning it untouched ensures json_decode() in update_block_content works correctly.
	 * Do NOT call an HTML sanitizer here - it will corrupt valid JSON.
	 */
	protected function sanitize_generated_content( $suggestion ) {
		return $suggestion;
	}

	/**
	 * Extract content for display/comparison.
	 */
	public function extract_content_from_html( $html ) {
		$text = wp_strip_all_tags( $html );
		return trim( preg_replace( '/\s+/', ' ', $text ) );
	}
}


/**
 * Intermediate Handler class for media based EDIT handlers (images, audio, video, files)
 */
abstract class MWPSFE_Abstract_Media_Edit_Handler extends MWPSFE_Abstract_Edit_Handler {
	
	public function content_type() { return 'media'; }

	// Default implementations - override in child classes
	public function get_media_tag()  { return 'img'; }
	public function get_media_attr() { return 'src'; }
	
	/**
	 * Extract media filename/info from HTML
	 * 
	 * @param string $html The HTML to extract from
	 * @return string Media filename or description
	 */
	public function extract_content_from_html( $html ) {
		$tag  = $this->get_media_tag();
		$attr = $this->get_media_attr();
		
		$pattern = '/<' . $tag . '[^>]+' . $attr . '=["\']([^"\']+)["\']/' ;
		
		if ( preg_match( $pattern, $html, $matches ) ) {
			$url      = $matches[1];
			$filename = basename( wp_parse_url( $url, PHP_URL_PATH ) );
			$filename = preg_replace( '/\?.*$/', '', $filename );
			return $filename ? $filename : ucfirst( $tag );
		}
		
		return ucfirst( $tag );
	}

	protected function sanitize_generated_content( $suggestion ) {
		$suggestion = trim( (string) $suggestion );
		// raw_block_content JSON payload - pass through unchanged
		if ( is_array( json_decode( $suggestion, true ) ) ) {
			return $suggestion;
		}
		return esc_url_raw( $suggestion );
	}
}

/**
 * Abstract base class for ALL container-type edit handlers.
 *
 * Containers have their own primary content (background media OR a heading element)
 * AND inner blocks. This base class declares container_type = 'pure', which
 * triggers surgical save and revert: only attrs + innerContent[0] are updated;
 * live inner blocks are always preserved.
 *
 * Schema-driven container descendants derive from this class:
 * - MWPSFE_Abstract_Schema_Media_Container_Edit_Handler (Cover, Media-Text)
 * - MWPSFE_Abstract_Schema_Text_Container_Edit_Handler (Details, etc.)
 */
abstract class MWPSFE_Abstract_Container_Edit_Handler extends MWPSFE_Abstract_Edit_Handler {

	public function container_type() { return 'pure'; }

	/**
	 * Surgical save: updates only attrs + innerContent[0] (the block's own wrapper HTML).
	 * Live inner blocks are never touched, matching the surgical revert behavior in
	 * the catalog. This prevents a cover background change or summary edit from
	 * clobbering independently-saved nested content.
	 */
	public function update_block_content( &$block, $new_content, $original_attrs ) {
		$payload = json_decode( $new_content, true );

		if ( ! $payload || ! is_array( $payload ) || ( $payload['_type'] ?? '' ) !== 'raw_block_content' ) {
			// Invalid payload shape for container raw block updates.
			return false;
		}

		$raw = $payload['rawContent'] ?? '';
		if ( empty( trim( $raw ) ) ) {
			// Empty raw content cannot be applied to a container block.
			return false;
		}

		$parsed_blocks = parse_blocks( $raw );
		$parsed_block  = null;
		foreach ( $parsed_blocks as $b ) {
			if ( ! empty( $b['blockName'] ) ) {
				$parsed_block = $b;
				break;
			}
		}

		if ( ! $parsed_block || $block['blockName'] !== $parsed_block['blockName'] ) {
			// Guard against parse failure or block type mismatch.
			return false;
		}

		$uuid = $block['attrs']['mwpSfeUuidShadow'] ?? ( $block['attrs']['mwpSfeUuid'] ?? '' );

		// Transplant attrs (media URL, summary text, dim-ratio, etc.) from the payload.
		// Re-insert UUID attrs at the FRONT of the attrs array.
		$new_attrs = $parsed_block['attrs'] ?? [];
		unset( $new_attrs['mwpSfeUuid'], $new_attrs['mwpSfeUuidShadow'] );
		$block['attrs'] = array_merge(
			array( 'mwpSfeUuid' => $uuid, 'mwpSfeUuidShadow' => $uuid ),
			$new_attrs
		);

		// Transplant only innerContent[0] - the opening wrapper HTML that contains the
		// block's own content (the <img>/<video> for media containers, or the <summary>
		// for text containers). The null-placeholder slots and closing tag remain from
		// the live block, so all nested inner-block edits are fully preserved.
		if ( ! empty( $parsed_block['innerContent'] ) && ! empty( $block['innerContent'] ) ) {
			$block['innerContent'][0] = $parsed_block['innerContent'][0];
		}

		// innerHTML is unused by serialize_blocks when innerBlocks are present.
		$block['innerHTML'] = '';

		return true;
	}
}

/**
 * Base class for schema-driven container edit handlers.
 *
 * Keeps the existing surgical container save behavior while shifting editable
 * behavior declaration into get_schema_definition().
 */
abstract class MWPSFE_Abstract_Schema_Container_Edit_Handler extends MWPSFE_Abstract_Container_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	/**
	 * Schema handlers receive JSON payloads and must not sanitize as HTML.
	 *
	 * @param string $suggestion
	 * @return string
	 */
	protected function sanitize_generated_content( $suggestion ) {
		return $suggestion;
	}
}

/**
 * Base class for schema-driven text container edit handlers.
 *
 * Schema bindings drive editing/save behavior. Compatibility metadata exposed
 * through get_media_zone_selector()/get_media_attr() is derived from the schema
 * definition (default text component + primary html/text binding), not from
 * hardcoded selector/attribute methods.
 */
abstract class MWPSFE_Abstract_Schema_Text_Container_Edit_Handler extends MWPSFE_Abstract_Schema_Container_Edit_Handler {

	public function content_type()   { return 'text'; }
	public function container_type() { return 'text'; }
	public function get_media_tag()  { return null; }

	/**
	 * Resolve the primary text component from schema definition.
	 *
	 * Preference order:
	 * 1) first valid text component marked default=true
	 * 2) first valid text component
	 *
	 * A valid text component has:
	 * - type = text
	 * - non-empty selector
	 * - at least one binding with source html/plaintext and non-empty path
	 *
	 * @return array{selector:string,path:string}|array
	 */
	protected function get_primary_schema_text_component() {
		$schema = (array) $this->get_schema_definition();
		if ( empty( $schema['components'] ) || ! is_array( $schema['components'] ) ) {
			return array();
		}

		$fallback = array();

		foreach ( $schema['components'] as $component ) {
			if ( ! is_array( $component ) ) {
				continue;
			}

			$component_type = isset( $component['type'] ) ? strtolower( trim( (string) $component['type'] ) ) : '';
			if ( 'text' !== $component_type ) {
				continue;
			}

			$selector = isset( $component['selector'] ) ? trim( (string) $component['selector'] ) : '';
			if ( '' === $selector ) {
				continue;
			}

			$path = '';
			$bindings = isset( $component['bindings'] ) && is_array( $component['bindings'] )
				? $component['bindings']
				: array();
			foreach ( $bindings as $binding ) {
				if ( ! is_array( $binding ) ) {
					continue;
				}

				$source = isset( $binding['source'] ) ? strtolower( trim( (string) $binding['source'] ) ) : '';
				if ( 'html' !== $source && 'plaintext' !== $source ) {
					continue;
				}

				$candidate_path = isset( $binding['path'] ) ? trim( (string) $binding['path'] ) : '';
				if ( '' === $candidate_path ) {
					continue;
				}

				$path = $candidate_path;
				break;
			}

			if ( '' === $path ) {
				continue;
			}

			$candidate = array(
				'selector' => $selector,
				'path'     => $path,
			);

			if ( ! empty( $component['default'] ) ) {
				return $candidate;
			}

			if ( empty( $fallback ) ) {
				$fallback = $candidate;
			}
		}

		return $fallback;
	}

	public function get_media_zone_selector() {
		$component = $this->get_primary_schema_text_component();
		return isset( $component['selector'] ) ? $component['selector'] : null;
	}

	public function get_media_attr() {
		$component = $this->get_primary_schema_text_component();
		return isset( $component['path'] ) ? $component['path'] : null;
	}

	/**
	 * Build a DOMDocument for schema preview extraction.
	 *
	 * @param string $html
	 * @return DOMDocument|null
	 */
	protected function build_preview_dom_document( $html ) {
		$html = (string) $html;
		if ( '' === trim( $html ) ) {
			return null;
		}

		libxml_use_internal_errors( true );
		$dom = new DOMDocument();
		$ok  = $dom->loadHTML(
			'<?xml encoding="UTF-8">' . $html,
			LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
		);
		libxml_clear_errors();

		return $ok ? $dom : null;
	}

	/**
	 * Split a selector list on commas while preserving simple pseudo arguments.
	 *
	 * @param string $selector
	 * @return string[]
	 */
	protected function split_schema_selector_groups( $selector ) {
		$groups = array();
		$buffer = '';
		$depth  = 0;
		$chars  = preg_split( '//u', (string) $selector, -1, PREG_SPLIT_NO_EMPTY );

		foreach ( $chars as $char ) {
			if ( '(' === $char ) {
				$depth++;
			} elseif ( ')' === $char && $depth > 0 ) {
				$depth--;
			}

			if ( ',' === $char && 0 === $depth ) {
				$group = trim( $buffer );
				if ( '' !== $group ) {
					$groups[] = $group;
				}
				$buffer = '';
				continue;
			}

			$buffer .= $char;
		}

		$group = trim( $buffer );
		if ( '' !== $group ) {
			$groups[] = $group;
		}

		return $groups;
	}

	/**
	 * Tokenize a selector group into simple selectors plus combinators.
	 *
	 * Supported subset:
	 * - descendant combinator
	 * - child combinator (>)
	 * - tag names / *
	 * - class selectors
	 * - :scope / :self
	 * - :not(.class)
	 *
	 * @param string $selector
	 * @return array<int,array<string,string>>
	 */
	protected function tokenize_schema_selector_group( $selector ) {
		$tokens = array();
		$buffer = '';
		$depth  = 0;
		$length = strlen( $selector );

		for ( $i = 0; $i < $length; $i++ ) {
			$char = $selector[ $i ];

			if ( '(' === $char ) {
				$depth++;
				$buffer .= $char;
				continue;
			}

			if ( ')' === $char ) {
				if ( $depth > 0 ) {
					$depth--;
				}
				$buffer .= $char;
				continue;
			}

			if ( 0 === $depth && '>' === $char ) {
				$part = trim( $buffer );
				if ( '' !== $part ) {
					$tokens[] = array(
						'combinator' => 'descendant',
						'selector'   => $part,
					);
				}
				$buffer = '';
				if ( ! empty( $tokens ) ) {
					$tokens[ count( $tokens ) - 1 ]['combinator'] = 'child';
				}
				continue;
			}

			if ( 0 === $depth && ctype_space( $char ) ) {
				$part = trim( $buffer );
				if ( '' !== $part ) {
					$tokens[] = array(
						'combinator' => 'descendant',
						'selector'   => $part,
					);
					$buffer = '';
				}
				continue;
			}

			$buffer .= $char;
		}

		$part = trim( $buffer );
		if ( '' !== $part ) {
			$tokens[] = array(
				'combinator' => 'descendant',
				'selector'   => $part,
			);
		}

		return $tokens;
	}

	/**
	 * Determine whether an element matches a supported schema selector fragment.
	 *
	 * @param \DOMElement $element
	 * @param string      $selector
	 * @param \DOMElement $root
	 * @return bool
	 */
	protected function element_matches_schema_selector( \DOMElement $element, $selector, \DOMElement $root ) {
		$selector = trim( (string) $selector );
		if ( '' === $selector ) {
			return false;
		}

		if ( ':scope' === $selector || ':self' === $selector ) {
			return $element->isSameNode( $root );
		}

		$not_classes = array();
		if ( preg_match_all( '/:not\(\.([A-Za-z0-9_-]+)\)/', $selector, $not_matches ) ) {
			$not_classes = $not_matches[1];
			$selector    = preg_replace( '/:not\(\.[A-Za-z0-9_-]+\)/', '', $selector );
		}

		$selector = trim( $selector );
		if ( '' === $selector ) {
			$selector = '*';
		}

		$tag     = '*';
		$classes = array();

		if ( preg_match( '/^[A-Za-z][A-Za-z0-9_-]*|\*/', $selector, $tag_match ) ) {
			$tag = strtolower( $tag_match[0] );
		}

		if ( preg_match_all( '/\.([A-Za-z0-9_-]+)/', $selector, $class_matches ) ) {
			$classes = $class_matches[1];
		}

		if ( '*' !== $tag && strtolower( $element->tagName ) !== $tag ) {
			return false;
		}

		$class_attr  = ' ' . preg_replace( '/\s+/', ' ', trim( $element->getAttribute( 'class' ) ) ) . ' ';
		foreach ( $classes as $class_name ) {
			if ( false === strpos( $class_attr, ' ' . $class_name . ' ' ) ) {
				return false;
			}
		}

		foreach ( $not_classes as $class_name ) {
			if ( false !== strpos( $class_attr, ' ' . $class_name . ' ' ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Find the first DOM element matching a supported schema selector.
	 *
	 * @param DOMDocument $dom
	 * @param string      $selector
	 * @return \DOMElement|null
	 */
	protected function find_first_schema_selector_match( DOMDocument $dom, $selector ) {
		$root = $dom->documentElement;
		if ( ! $root ) {
			return null;
		}

		foreach ( $this->split_schema_selector_groups( $selector ) as $group ) {
			$current = array( $root );
			$tokens  = $this->tokenize_schema_selector_group( $group );
			if ( empty( $tokens ) ) {
				continue;
			}

			foreach ( $tokens as $index => $token ) {
				$next = array();
				foreach ( $current as $context ) {
					if ( ! $context instanceof \DOMElement ) {
						continue;
					}

					$candidates = array();
					if ( 0 === $index ) {
						$candidates[] = $context;
					}

					if ( 'child' === $token['combinator'] ) {
						foreach ( $context->childNodes as $child_node ) {
							if ( $child_node instanceof \DOMElement ) {
								$candidates[] = $child_node;
							}
						}
					} else {
						foreach ( $context->getElementsByTagName( '*' ) as $descendant ) {
							if ( $descendant instanceof \DOMElement ) {
								$candidates[] = $descendant;
							}
						}
					}

					foreach ( $candidates as $candidate ) {
						if ( $this->element_matches_schema_selector( $candidate, $token['selector'], $context ) ) {
							$next[] = $candidate;
						}
					}
				}

				if ( empty( $next ) ) {
					$current = array();
					break;
				}

				$current = $next;
			}

			if ( ! empty( $current ) ) {
				return $current[0];
			}
		}

		return null;
	}

	/**
	 * Extract text for cards/history previews.
	 *
	 * @param string $html
	 * @return string
	 */
	public function extract_content_from_html( $html ) {
		$component = $this->get_primary_schema_text_component();
		$selector  = isset( $component['selector'] ) ? (string) $component['selector'] : '';
		if ( $selector ) {
			$dom = $this->build_preview_dom_document( $html );
			if ( $dom ) {
				$match = $this->find_first_schema_selector_match( $dom, $selector );
				if ( $match ) {
					return trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( $match->textContent ) ) );
				}
			}
		}

		return trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( $html ) ) );
	}
}

/**
 * Intermediate abstract class for MEDIA container handlers (Cover, Media-Text).
 *
 * Extends the container base and adds all background-media logic: img/video detection,
 * URL sanitization, and the media element trait.
 */
abstract class MWPSFE_Abstract_Media_Container_Edit_Handler extends MWPSFE_Abstract_Container_Edit_Handler {

	public function content_type()   { return 'media'; }
	public function container_type() { return 'media'; }

	// Subclasses declare the default media tag; containers can switch img/video.
	public function get_media_attr() { return 'src'; }

	/**
	 * Container media blocks (Cover, Media-Text) can hold either an <img> or a
	 * <video> element depending on what the user uploaded.  Return both so the
	 * renderer's fallback regex matches whichever tag is actually present.
	 *
	 * @return string[]
	 */
	public function get_media_tags(): array {
		return [ 'img', 'video' ];
	}

	/**
	 * Get the media element (img or video) from the container DOM.
	 */
	protected function get_container_media_element( $dom ) {
		$img = $dom->getElementsByTagName('img')->item(0);
		if ( $img ) return $img;
		$video = $dom->getElementsByTagName('video')->item(0);
		if ( $video ) return $video;
		return null;
	}

	protected function get_current_media_type( $block ) {
		if ( isset( $block['attrs']['backgroundType'] ) ) return $block['attrs']['backgroundType'];
		$html = $block['innerHTML'] ?? '';
		return ( strpos( $html, '<video' ) !== false ) ? 'video' : 'image';
	}

	protected function get_media_type_from_url( $url ) {
		$ext = strtolower( pathinfo( wp_parse_url( $url, PHP_URL_PATH ), PATHINFO_EXTENSION ) );
		$video_exts = array( 'mp4', 'webm', 'ogv', 'mov', 'avi', 'wmv', 'm4v' );
		return in_array( $ext, $video_exts, true ) ? 'video' : 'image';
	}

	public function extract_content_from_html( $html ) {
		if ( preg_match( '/<(?:video|source)[^>]+src=["\']([^"\']+)["\']/i', $html, $m ) ) {
			$f = basename( wp_parse_url( $m[1], PHP_URL_PATH ) );
			if ( $f ) return $f;
		}
		if ( preg_match( '/background-image:\s*url\(["\']?([^"\')\s]+)["\']?\)/i', $html, $m ) ) {
			$f = basename( wp_parse_url( $m[1], PHP_URL_PATH ) );
			if ( $f ) return $f;
		}
		if ( preg_match( '/<img[^>]+src=["\']([^"\']+)["\']/i', $html, $m ) ) {
			$f = basename( wp_parse_url( $m[1], PHP_URL_PATH ) );
			if ( $f ) return $f;
		}
		return 'Media';
	}

	protected function sanitize_generated_content( $suggestion ) {
		$suggestion = trim( (string) $suggestion );
		if ( is_array( json_decode( $suggestion, true ) ) ) return $suggestion;
		return esc_url_raw( $suggestion );
	}
}

/**
 * Base class for schema-driven media edit handlers.
 *
 * Compatibility metadata exposed through get_media_tag()/get_media_attr()/
 * get_media_zone_selector()/get_block_url_attr() is derived from the schema
 * file component definition instead of hardcoded handler methods.
 */
abstract class MWPSFE_Abstract_Schema_Media_Edit_Handler extends MWPSFE_Abstract_Media_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	/**
	 * Resolve the primary file component from schema definition.
	 *
	 * Preference order:
	 * 1) first valid file component marked default=true
	 * 2) first valid file component
	 *
	 * @return array{selector:string,targetSelector:string,targetAttr:string,mediaType:string,urlPath:?string}|array
	 */
	protected function get_primary_schema_file_component() {
		$schema = (array) $this->get_schema_definition();
		if ( empty( $schema['components'] ) || ! is_array( $schema['components'] ) ) {
			return array();
		}

		$fallback = array();

		foreach ( $schema['components'] as $component ) {
			if ( ! is_array( $component ) ) {
				continue;
			}

			$component_type = isset( $component['type'] ) ? strtolower( trim( (string) $component['type'] ) ) : '';
			if ( 'file' !== $component_type ) {
				continue;
			}

			$selector = isset( $component['selector'] ) ? trim( (string) $component['selector'] ) : '';
			if ( '' === $selector ) {
				continue;
			}

			$target = isset( $component['target'] ) && is_array( $component['target'] )
				? $component['target']
				: array();
			$target_selector = isset( $target['selector'] ) ? trim( (string) $target['selector'] ) : '';
			$target_attr     = isset( $target['attribute'] ) ? strtolower( trim( (string) $target['attribute'] ) ) : '';
			$media_type      = isset( $target['mediaType'] ) ? strtolower( trim( (string) $target['mediaType'] ) ) : '';

			if ( '' === $target_selector || '' === $target_attr || '' === $media_type ) {
				continue;
			}

			$url_path = null;
			$bindings = isset( $component['bindings'] ) && is_array( $component['bindings'] )
				? $component['bindings']
				: array();
			foreach ( $bindings as $binding ) {
				if ( ! is_array( $binding ) ) {
					continue;
				}

				$source = isset( $binding['source'] ) ? strtolower( trim( (string) $binding['source'] ) ) : '';
				if ( 'url' !== $source ) {
					continue;
				}

				$path = isset( $binding['path'] ) ? trim( (string) $binding['path'] ) : '';
				if ( '' === $path ) {
					continue;
				}

				$url_path = $path;
				break;
			}

			$candidate = array(
				'selector'       => $selector,
				'targetSelector' => $target_selector,
				'targetAttr'     => $target_attr,
				'mediaType'      => $media_type,
				'urlPath'        => $url_path,
			);

			if ( ! empty( $component['default'] ) ) {
				return $candidate;
			}

			if ( empty( $fallback ) ) {
				$fallback = $candidate;
			}
		}

		return $fallback;
	}

	public function get_media_tag() {
		$component = $this->get_primary_schema_file_component();
		$media_type = isset( $component['mediaType'] ) ? strtolower( (string) $component['mediaType'] ) : '';
		if ( 'audio' === $media_type ) return 'audio';
		if ( 'video' === $media_type ) return 'video';
		if ( 'file' === $media_type ) return 'a';
		if ( 'image' === $media_type || 'image_or_video' === $media_type ) return 'img';
		return null;
	}

	public function get_media_attr() {
		$component = $this->get_primary_schema_file_component();
		return isset( $component['targetAttr'] ) ? $component['targetAttr'] : null;
	}

	public function get_media_zone_selector() {
		$component = $this->get_primary_schema_file_component();
		return isset( $component['selector'] ) ? $component['selector'] : null;
	}

	public function get_block_url_attr() {
		$component = $this->get_primary_schema_file_component();
		$url_path  = isset( $component['urlPath'] ) ? trim( (string) $component['urlPath'] ) : '';
		if ( preg_match( '/^[a-zA-Z_][a-zA-Z0-9_]*$/', $url_path ) ) {
			return $url_path;
		}
		return null;
	}
}

/**
 * Base class for schema-driven media container edit handlers.
 *
 * Preserves container-specific surgical save behavior while deriving media
 * compatibility metadata from the schema file component definition.
 */
abstract class MWPSFE_Abstract_Schema_Media_Container_Edit_Handler extends MWPSFE_Abstract_Media_Container_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	/**
	 * Resolve the primary file component from schema definition.
	 *
	 * Preference order:
	 * 1) first valid file component marked default=true
	 * 2) first valid file component
	 *
	 * @return array{selector:string,targetSelector:string,targetAttr:string,mediaType:string,urlPath:?string}|array
	 */
	protected function get_primary_schema_file_component() {
		$schema = (array) $this->get_schema_definition();
		if ( empty( $schema['components'] ) || ! is_array( $schema['components'] ) ) {
			return array();
		}

		$fallback = array();

		foreach ( $schema['components'] as $component ) {
			if ( ! is_array( $component ) ) {
				continue;
			}

			$component_type = isset( $component['type'] ) ? strtolower( trim( (string) $component['type'] ) ) : '';
			if ( 'file' !== $component_type ) {
				continue;
			}

			$selector = isset( $component['selector'] ) ? trim( (string) $component['selector'] ) : '';
			if ( '' === $selector ) {
				continue;
			}

			$target = isset( $component['target'] ) && is_array( $component['target'] )
				? $component['target']
				: array();
			$target_selector = isset( $target['selector'] ) ? trim( (string) $target['selector'] ) : '';
			$target_attr     = isset( $target['attribute'] ) ? strtolower( trim( (string) $target['attribute'] ) ) : '';
			$media_type      = isset( $target['mediaType'] ) ? strtolower( trim( (string) $target['mediaType'] ) ) : '';

			if ( '' === $target_selector || '' === $target_attr || '' === $media_type ) {
				continue;
			}

			$url_path = null;
			$bindings = isset( $component['bindings'] ) && is_array( $component['bindings'] )
				? $component['bindings']
				: array();
			foreach ( $bindings as $binding ) {
				if ( ! is_array( $binding ) ) {
					continue;
				}

				$source = isset( $binding['source'] ) ? strtolower( trim( (string) $binding['source'] ) ) : '';
				if ( 'url' !== $source ) {
					continue;
				}

				$path = isset( $binding['path'] ) ? trim( (string) $binding['path'] ) : '';
				if ( '' === $path ) {
					continue;
				}

				$url_path = $path;
				break;
			}

			$candidate = array(
				'selector'       => $selector,
				'targetSelector' => $target_selector,
				'targetAttr'     => $target_attr,
				'mediaType'      => $media_type,
				'urlPath'        => $url_path,
			);

			if ( ! empty( $component['default'] ) ) {
				return $candidate;
			}

			if ( empty( $fallback ) ) {
				$fallback = $candidate;
			}
		}

		return $fallback;
	}

	public function get_media_tag() {
		$component = $this->get_primary_schema_file_component();
		$media_type = isset( $component['mediaType'] ) ? strtolower( (string) $component['mediaType'] ) : '';
		if ( 'audio' === $media_type ) return 'audio';
		if ( 'video' === $media_type ) return 'video';
		if ( 'file' === $media_type ) return 'a';
		if ( 'image' === $media_type || 'image_or_video' === $media_type ) return 'img';
		return null;
	}

	public function get_media_attr() {
		$component = $this->get_primary_schema_file_component();
		return isset( $component['targetAttr'] ) ? $component['targetAttr'] : null;
	}

	public function get_media_zone_selector() {
		$component = $this->get_primary_schema_file_component();
		return isset( $component['selector'] ) ? $component['selector'] : null;
	}

	public function get_block_url_attr() {
		$component = $this->get_primary_schema_file_component();
		$url_path  = isset( $component['urlPath'] ) ? trim( (string) $component['urlPath'] ) : '';
		if ( preg_match( '/^[a-zA-Z_][a-zA-Z0-9_]*$/', $url_path ) ) {
			return $url_path;
		}
		return null;
	}
}

/**
 * Schema-driven core/paragraph edit handler.
 */
class MWPSFE_Handler_Core_Paragraph extends MWPSFE_Abstract_Text_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	public function id()                { return 'core_paragraph'; }
	public function title()             { return 'Edit Paragraph'; }
	public function element_type()      { return 'Paragraph'; }
	public function element_type_code() { return 'paragraph'; }
	public function description()       { return 'Edit this paragraph.'; }
	public function call_to_action()    { return 'Click to edit this paragraph.'; }

	public function get_supported_blocks() {
		return array( 'core/paragraph' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Paragraph();
	}

	/**
	 * Minimal strict schema contract for core/paragraph.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );
		$attribute_capabilities     = array(
			'align' => array(
				'attribute'  => 'align',
				'values'     => array( 'none', 'wide', 'full' ),
				'unsetValue' => 'none',
			),
			'textAlignment' => array(
				'attribute'  => 'style.typography.textAlign',
				'values'     => array( 'left', 'center', 'right', 'justify' ),
				'unsetValue' => 'left',
			),
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/paragraph',
				'type' => 'text',
			),
			'identity' => array(
				// A pristine native paragraph is Gutenberg's reusable writing surface.
				// UUID lifecycle consumers must leave this exact serialized state unowned
				// until the author changes it, then retain the UUID forever.
				'pristineDefaultInnerHTML' => '<p></p>',
			),
			'components' => array(
				array(
					'id'          => 'content',
					'label'       => 'Paragraph',
					'type'        => 'text',
					'selector'    => ':scope',
					'default'     => true,
					'required'    => true,
					'placeholder' => 'Add text',
					'bindings'    => array(
						array(
							'path'   => 'content',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'never',
						'formats'   => array(
							array( 'undo', 'redo' ),
							array( 'align', 'textAlignment' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'formatTargets' => array(
							'align' => 'block',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'attributeCapabilities'    => $attribute_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'content', $attribute_capabilities['align'] ),
								$this->get_editor_block_attribute_change_operation( 'set_text_align', 'content', $attribute_capabilities['textAlignment'] ),
								$this->get_editor_text_rewrite_operation( 'content' ),
								$this->get_editor_inline_format_change_operation( 'content', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'content', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/heading edit handler.
 */
class MWPSFE_Handler_Core_Heading extends MWPSFE_Abstract_Text_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	public function id()                { return 'core_heading'; }
	public function title()             { return 'Edit Heading'; }
	public function element_type()      { return 'Heading'; }
	public function element_type_code() { return 'heading'; }
	public function description()       { return 'Edit this heading.'; }
	public function call_to_action()    { return 'Click to edit this heading.'; }

	public function get_supported_blocks() {
		return array( 'core/heading' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Heading();
	}

	/**
	 * Minimal strict schema contract for core/heading.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );
		$attribute_capabilities     = array(
			'headingLevels' => array(
				'attribute' => 'level',
				'values'    => array( 1, 2, 3, 4, 5, 6 ),
			),
			'align' => array(
				'attribute'  => 'align',
				'values'     => array( 'none', 'wide', 'full' ),
				'unsetValue' => 'none',
			),
			'textAlignment' => array(
				'attribute'  => 'style.typography.textAlign',
				'values'     => array( 'left', 'center', 'right', 'justify' ),
				'unsetValue' => 'left',
			),
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/heading',
				'type' => 'text',
			),
			'components' => array(
				array(
					'id'          => 'content',
					'label'       => 'Heading',
					'type'        => 'text',
					'selector'    => ':scope',
					'default'     => true,
					'required'    => true,
					'placeholder' => 'Heading',
					'bindings'    => array(
						array(
							'path'   => 'content',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'never',
						'formats'   => array(
							array( 'undo', 'redo' ),
							'headingLevels',
							array( 'align', 'textAlignment' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'formatTargets' => array(
							'align' => 'block',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'attributeCapabilities'    => $attribute_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'content', $attribute_capabilities['align'] ),
								$this->get_editor_block_attribute_change_operation( 'set_heading_level', 'content', $attribute_capabilities['headingLevels'] ),
								$this->get_editor_block_attribute_change_operation( 'set_text_align', 'content', $attribute_capabilities['textAlignment'] ),
								$this->get_editor_text_rewrite_operation( 'content' ),
								$this->get_editor_inline_format_change_operation( 'content', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'content', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/list edit handler.
 *
 * Keeps list editing scoped to the block root element so nested lists remain
 * part of one editing surface and one serialized block payload.
 */
class MWPSFE_Handler_Core_List extends MWPSFE_Abstract_Text_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	public function id()                { return 'core_list'; }
	public function title()             { return 'Edit List'; }
	public function element_type()      { return 'List'; }
	public function element_type_code() { return 'list'; }
	public function description()       { return 'Edit this list.'; }
	public function call_to_action()    { return 'Click to edit this list.'; }

	public function get_supported_blocks() {
		return array( 'core/list' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_List();
	}

	/**
	 * Keep legacy list preview extraction: flatten all list item text.
	 *
	 * @param string $html
	 * @return string
	 */
	public function extract_content_from_html( $html ) {
		if ( preg_match( '/<(ul|ol)/', $html ) ) {
			$dom = new DOMDocument();
			libxml_use_internal_errors( true );
			$dom->loadHTML( '<?xml encoding="utf-8" ?>' . $html, LIBXML_HTML_NODEFDTD | LIBXML_HTML_NOIMPLIED );
			libxml_clear_errors();

			$xpath = new DOMXPath( $dom );
			$items = $xpath->query( '//li' );
			$texts = array();

			foreach ( $items as $item ) {
				$text = '';
				foreach ( $item->childNodes as $child ) {
					if ( $child->nodeType === XML_TEXT_NODE ) {
						$text .= $child->textContent;
					} elseif ( $child->nodeType === XML_ELEMENT_NODE &&
						$child->tagName !== 'ul' &&
						$child->tagName !== 'ol' ) {
						$text .= $child->textContent;
					}
				}

				$text = trim( preg_replace( '/\s+/', ' ', $text ) );
				if ( $text ) {
					$texts[] = $text;
				}
			}

			if ( ! empty( $texts ) ) {
				return implode( ', ', $texts );
			}
		}

		return parent::extract_content_from_html( $html );
	}

	/**
	 * Minimal strict schema contract for core/list.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );
		$attribute_capabilities     = array(
			'orderedList' => array(
				'attribute' => 'ordered',
				'values'    => array( true ),
			),
			'unorderedList' => array(
				'attribute' => 'ordered',
				'values'    => array( false ),
			),
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/list',
				'type' => 'text',
			),
			'components' => array(
				array(
					'id'          => 'list_root',
					'label'       => 'List',
					'type'        => 'text',
					'selector'    => ':scope',
					'default'     => true,
					'apiEditable' => false,
					'required'    => true,
					'placeholder' => 'List',
					'bindings'    => array(
						array(
							'path'   => '__list_block__',
							'source' => 'list_block',
						),
					),
					'editor' => array(
						'tabMode' => array(
							'tab'      => 'indent',
							'shiftTab' => 'outdent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'unorderedList', 'orderedList' ),
							array( 'outdent', 'indent' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'attributeCapabilities'    => $attribute_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_list_structure_operation( 'toggle_list_type', 'list_root', 'toggle_list_type' ),
								$this->get_editor_block_attribute_change_operation( 'set_unordered_list', 'list_root', $attribute_capabilities['unorderedList'] ),
								$this->get_editor_block_attribute_change_operation( 'set_ordered_list', 'list_root', $attribute_capabilities['orderedList'] ),
								$this->get_editor_text_rewrite_operation( 'list_root' ),
								$this->get_editor_inline_format_change_operation( 'list_root', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'list_root', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
				array(
					'id'          => 'list_item',
					'label'       => 'List Item',
					'type'        => 'text',
					'selector'    => '[data-mwp-sfe-list-item-text="1"]',
					'uiEditable'  => false,
					'repeat'      => array(
						'mode'         => 'tree_path',
						'itemSelector' => 'li',
						'pathKey'      => 'path',
					),
					'bindings'    => array(
						array(
							'path'   => '__list_item__.{path}',
							'source' => 'html',
						),
					),
					'editor' => array(
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_text_rewrite_operation( 'list_item' ),
								$this->get_editor_inline_format_change_operation( 'list_item', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'list_item', 'link', $inline_format_capabilities ),
								$this->get_editor_list_structure_operation( 'insert_list_item', 'list_item', 'insert_list_item' ),
								$this->get_editor_list_structure_operation( 'remove_list_item', 'list_item', 'remove_list_item' ),
								$this->get_editor_list_structure_operation( 'move_list_item', 'list_item', 'move_list_item' ),
								$this->get_editor_list_structure_operation( 'indent_list_item', 'list_item', 'indent_list_item' ),
								$this->get_editor_list_structure_operation( 'outdent_list_item', 'list_item', 'outdent_list_item' ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/code edit handler.
 */
class MWPSFE_Handler_Core_Code extends MWPSFE_Abstract_Text_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	public function id()                { return 'core_code'; }
	public function title()             { return 'Edit Code'; }
	public function element_type()      { return 'Code'; }
	public function element_type_code() { return 'code'; }
	public function description()       { return 'Edit this code block.'; }
	public function call_to_action()    { return 'Click to edit this code.'; }

	public function get_supported_blocks() {
		return array( 'core/code' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Code();
	}

	/**
	 * Minimal strict schema contract for core/code.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );
		$attribute_capabilities     = array(
			'align' => array(
				'attribute'  => 'align',
				'values'     => array( 'none', 'wide' ),
				'unsetValue' => 'none',
			),
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/code',
				'type' => 'text',
			),
			'components' => array(
				array(
					'id'          => 'content',
					'label'       => 'Code',
					'type'        => 'text',
					'selector'    => 'code',
					'default'     => true,
					'required'    => true,
					'placeholder' => 'Write code...',
					'bindings'    => array(
						array(
							'path'   => 'content',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'linebreak',
						'options'   => array(
							'preserveNewlines' => true,
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							'align',
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'formatTargets' => array(
							'align' => 'block',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'attributeCapabilities'    => $attribute_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'content', $attribute_capabilities['align'] ),
								$this->get_editor_text_rewrite_operation( 'content' ),
								$this->get_editor_inline_format_change_operation( 'content', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'content', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/preformatted edit handler.
 */
class MWPSFE_Handler_Core_Preformatted extends MWPSFE_Abstract_Text_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	public function id()                { return 'core_preformatted'; }
	public function title()             { return 'Edit Preformatted'; }
	public function element_type()      { return 'Preformatted'; }
	public function element_type_code() { return 'preformatted'; }
	public function description()       { return 'Edit this preformatted block.'; }
	public function call_to_action()    { return 'Click to edit this preformatted text.'; }

	public function get_supported_blocks() {
		return array( 'core/preformatted' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Preformatted();
	}

	/**
	 * Minimal strict schema contract for core/preformatted.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/preformatted',
				'type' => 'text',
			),
			'components' => array(
				array(
					'id'          => 'content',
					'label'       => 'Preformatted Text',
					'type'        => 'text',
					'selector'    => 'pre',
					'default'     => true,
					'required'    => true,
					'placeholder' => 'Write preformatted text...',
					'bindings'    => array(
						array(
							'path'   => 'content',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'linebreak',
						'options'   => array(
							'newlinesToBR' => true,
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_text_rewrite_operation( 'content' ),
								$this->get_editor_inline_format_change_operation( 'content', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'content', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/verse edit handler.
 */
class MWPSFE_Handler_Core_Verse extends MWPSFE_Abstract_Text_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	public function id()                { return 'core_verse'; }
	public function title()             { return 'Edit Verse'; }
	public function element_type()      { return 'Verse'; }
	public function element_type_code() { return 'verse'; }
	public function description()       { return 'Edit this verse block.'; }
	public function call_to_action()    { return 'Click to edit this verse.'; }

	public function get_supported_blocks() {
		return array( 'core/verse' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Verse();
	}

	/**
	 * Minimal strict schema contract for core/verse.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );
		$attribute_capabilities     = array(
			'textAlignment' => array(
				'attribute'  => 'style.typography.textAlign',
				'values'     => array( 'left', 'center', 'right', 'justify' ),
				'unsetValue' => 'left',
			),
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/verse',
				'type' => 'text',
			),
			'components' => array(
				array(
					'id'          => 'content',
					'label'       => 'Verse',
					'type'        => 'text',
					'selector'    => 'pre',
					'default'     => true,
					'required'    => true,
					'placeholder' => 'Write verse...',
					'bindings'    => array(
						array(
							'path'   => 'content',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'linebreak',
						'options'   => array(
							'newlinesToBR' => true,
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							'textAlignment',
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'attributeCapabilities'    => $attribute_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_text_align', 'content', $attribute_capabilities['textAlignment'] ),
								$this->get_editor_text_rewrite_operation( 'content' ),
								$this->get_editor_inline_format_change_operation( 'content', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'content', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/accordion-heading edit handler.
 *
 * Keeps the existing text edit/save behavior while declaring the editable title
 * binding through the schema contract for the generic schema runtime.
 */
class MWPSFE_Handler_Core_Accordion_Heading extends MWPSFE_Abstract_Text_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	public function id()                { return 'core_accordion_heading'; }
	public function title()             { return 'Edit Accordion'; }
	public function element_type()      { return 'Accordion Heading'; }
	public function element_type_code() { return 'accordion-heading'; }
	public function description()       { return 'Edit this accordion heading.'; }
	public function call_to_action()    { return 'Click to edit this accordion heading.'; }

	public function get_supported_blocks() {
		return array( 'core/accordion-heading' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Accordion_Heading();
	}

	/**
	 * Resolve the primary text component for compatibility metadata.
	 *
	 * @return array{selector:string,path:string}|array
	 */
	private function get_primary_schema_text_component() {
		$schema = (array) $this->get_schema_definition();
		if ( empty( $schema['components'] ) || ! is_array( $schema['components'] ) ) {
			return array();
		}

		$fallback = array();

		foreach ( $schema['components'] as $component ) {
			if ( ! is_array( $component ) ) {
				continue;
			}

			$component_type = isset( $component['type'] ) ? strtolower( trim( (string) $component['type'] ) ) : '';
			if ( 'text' !== $component_type ) {
				continue;
			}

			$selector = isset( $component['selector'] ) ? trim( (string) $component['selector'] ) : '';
			if ( '' === $selector ) {
				continue;
			}

			$path = '';
			$bindings = isset( $component['bindings'] ) && is_array( $component['bindings'] )
				? $component['bindings']
				: array();
			foreach ( $bindings as $binding ) {
				if ( ! is_array( $binding ) ) {
					continue;
				}

				$source = isset( $binding['source'] ) ? strtolower( trim( (string) $binding['source'] ) ) : '';
				if ( 'html' !== $source && 'plaintext' !== $source ) {
					continue;
				}

				$candidate_path = isset( $binding['path'] ) ? trim( (string) $binding['path'] ) : '';
				if ( '' === $candidate_path ) {
					continue;
				}

				$path = $candidate_path;
				break;
			}

			if ( '' === $path ) {
				continue;
			}

			$candidate = array(
				'selector' => $selector,
				'path'     => $path,
			);

			if ( ! empty( $component['default'] ) ) {
				return $candidate;
			}

			if ( empty( $fallback ) ) {
				$fallback = $candidate;
			}
		}

		return $fallback;
	}

	public function get_media_zone_selector() {
		$component = $this->get_primary_schema_text_component();
		return isset( $component['selector'] ) ? $component['selector'] : null;
	}

	public function get_media_attr() {
		$component = $this->get_primary_schema_text_component();
		return isset( $component['path'] ) ? $component['path'] : null;
	}

	/**
	 * Keep title-only history/card extraction (exclude icon span text).
	 *
	 * @param string $html
	 * @return string
	 */
	public function extract_content_from_html( $html ) {
		$selector = (string) $this->get_media_zone_selector();
		$class    = '';
		if ( preg_match( '/^\.([a-zA-Z0-9_-]+)$/', trim( $selector ), $matches ) ) {
			$class = $matches[1];
		}

		libxml_use_internal_errors( true );
		$dom = new DOMDocument();
		$dom->loadHTML( '<?xml encoding="UTF-8">' . $html, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD );
		libxml_clear_errors();
		if ( '' !== $class ) {
			$finder = new DOMXPath( $dom );
			$query  = sprintf(
				'//*[contains(concat(" ", normalize-space(@class), " "), " %s ")]',
				$class
			);
			$nodes = $finder->query( $query );
			if ( $nodes && $nodes->length > 0 ) {
				return trim( wp_strip_all_tags( $dom->saveHTML( $nodes->item( 0 ) ) ) );
			}
		}
		return trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( $html ) ) );
	}

	/**
	 * Minimal strict schema contract for core/accordion-heading.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/accordion-heading',
				'type' => 'text',
			),
			'components' => array(
				array(
					'id'          => 'title',
					'label'       => 'Title',
					'type'        => 'text',
					'selector'    => '.wp-block-accordion-heading__toggle-title',
					'default'     => true,
					'required'    => true,
					'placeholder' => 'Accordion title',
					'bindings'    => array(
						array(
							'path'   => 'title',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'never',
						'formats'   => array(
							array( 'undo', 'redo' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_text_rewrite_operation( 'title' ),
								$this->get_editor_inline_format_change_operation( 'title', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'title', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/button edit handler.
 *
 * Extends the legacy button handler so existing capability metadata and comment
 * companion behavior remain unchanged while exposing schema bindings for the
 * generic schema runtime path.
 */
class MWPSFE_Handler_Core_Button extends MWPSFE_Abstract_Text_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	public function id()                { return 'core_button'; }
	public function title()             { return 'Edit Button'; }
	public function element_type()      { return 'Button'; }
	public function element_type_code() { return 'button'; }
	public function description()       { return 'Edit the label text of this button.'; }
	public function call_to_action()    { return 'Click to edit the button text.'; }

	public function get_supported_blocks() {
		return array( 'core/button' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Button();
	}

	/**
	 * Minimal strict schema contract for core/button.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'buttonLink', 'bold', 'italic', 'strikethrough' ) );
		$attribute_capabilities     = array(
			'textAlignment' => array(
				'attribute'  => 'style.typography.textAlign',
				'values'     => array( 'left', 'center', 'right', 'justify' ),
				'unsetValue' => 'left',
			),
			'buttonLink' => array(
				'attributes' => array( 'url', 'linkTarget', 'rel' ),
			),
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/button',
				'type' => 'text',
			),
			'components' => array(
				array(
					'id'          => 'label',
					'label'       => 'Button Label',
					'type'        => 'text',
					'selector'    => '.wp-block-button__link',
					'default'     => true,
					'required'    => true,
					'placeholder' => 'Add text',
					'bindings'    => array(
						array(
							'path'   => 'text',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode'  => 'never',
						'linkUIMode' => 'manual',
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'textAlignment', 'buttonLink' ),
							array( 'bold', 'italic', 'strikethrough' ),
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'attributeCapabilities'    => $attribute_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_text_align', 'label', $attribute_capabilities['textAlignment'] ),
								$this->get_editor_text_rewrite_operation( 'label' ),
								$this->get_editor_inline_format_change_operation( 'label', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_link_change_operation( 'set_button_link', 'label', 'buttonLink', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/pullquote edit handler.
 *
 * Extends the legacy multi-component handler so existing behavior remains
 * available while exposing a strict schema contract for the schema runtime.
 */
class MWPSFE_Handler_Core_Pullquote extends MWPSFE_Abstract_Text_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	public function id()                { return 'core_pullquote'; }
	public function title()             { return 'Edit Pullquote'; }
	public function element_type()      { return 'Pullquote'; }
	public function element_type_code() { return 'pullquote'; }
	public function description()       { return 'Edit this pullquote.'; }
	public function call_to_action()    { return 'Click to edit this pullquote.'; }

	public function get_supported_blocks() {
		return array( 'core/pullquote' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Pullquote();
	}

	/**
	 * Minimal strict schema contract for core/pullquote.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );
		$attribute_capabilities     = array(
			'align' => array(
				'attribute'  => 'align',
				'values'     => array( 'none', 'wide', 'full', 'left', 'right' ),
				'unsetValue' => 'none',
			),
			'textAlignment' => array(
				'attribute'  => 'textAlign',
				'values'     => array( 'left', 'center', 'right' ),
			),
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/pullquote',
				'type' => 'text',
			),
			'components' => array(
				array(
					'id'          => 'quote',
					'label'       => 'Quote',
					'type'        => 'text',
					'selector'    => 'blockquote > p',
					'default'     => true,
					'required'    => true,
					'placeholder' => 'Add quote',
					'bindings'    => array(
						array(
							'path'   => 'value',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'linebreak',
						'tabMode'   => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'align', 'textAlignment' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'formatTargets' => array(
							'align'         => 'block',
							'textAlignment' => 'block',
						),
						'attributeCapabilities' => $attribute_capabilities,
						'operations'            => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'content', $attribute_capabilities['align'] ),
								$this->get_editor_block_attribute_change_operation( 'set_text_align', 'quote', $attribute_capabilities['textAlignment'] ),
								$this->get_editor_text_rewrite_operation( 'quote' ),
								$this->get_editor_inline_format_change_operation( 'quote', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'quote', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
				array(
					'id'          => 'citation',
					'label'       => 'Citation',
					'type'        => 'text',
					'selector'    => 'blockquote > cite',
					'placeholder' => 'Add citation',
					'missingUI'   => array(
						'mode'          => 'ghost',
						'mountSelector' => 'blockquote',
						'placement'     => 'append',
						'tag'           => 'cite',
					),
					'bindings' => array(
						array(
							'path'   => 'citation',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'never',
						'tabMode'   => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'align', 'textAlignment' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'formatTargets' => array(
							'align'         => 'block',
							'textAlignment' => 'block',
						),
						'attributeCapabilities' => $attribute_capabilities,
						'operations'            => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'content', $attribute_capabilities['align'] ),
								$this->get_editor_block_attribute_change_operation( 'set_text_align', 'citation', $attribute_capabilities['textAlignment'] ),
								$this->get_editor_text_rewrite_operation( 'citation' ),
								$this->get_editor_inline_format_change_operation( 'citation', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'citation', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/details edit handler.
 *
 * Uses a schema-declared summary component while retaining container surgical
 * save semantics through the schema container ancestry.
 */
class MWPSFE_Handler_Core_Details extends MWPSFE_Abstract_Schema_Text_Container_Edit_Handler {

	public function id()                { return 'core_details'; }
	public function title()             { return 'Edit Details'; }
	public function element_type()      { return 'Details'; }
	public function element_type_code() { return 'details'; }
	public function description()       { return 'Edit this summary heading.'; }
	public function call_to_action()    { return 'Click to edit this details summary.'; }

	public function get_supported_blocks() {
		return array( 'core/details' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Details();
	}

	/**
	 * Minimal strict schema contract for core/details.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );
		$attribute_capabilities     = array(
			'align' => array(
				'attribute'  => 'align',
				'values'     => array( 'none', 'wide', 'full' ),
				'unsetValue' => 'none',
			),
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/details',
				'type' => 'text',
			),
			'components' => array(
				array(
					'id'          => 'summary',
					'label'       => 'Summary',
					'type'        => 'text',
					'selector'    => 'summary',
					'default'     => true,
					'required'    => true,
					'placeholder' => 'Write summary',
					'bindings'    => array(
						array(
							'path'   => 'summary',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'never',
						'formats'   => array(
							array( 'undo', 'redo' ),
							'align',
							array( 'bold', 'italic', 'strikethrough' ),
						),
						'formatTargets' => array(
							'align' => 'block',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'attributeCapabilities'    => $attribute_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'content', $attribute_capabilities['align'] ),
								$this->get_editor_text_rewrite_operation( 'summary' ),
								$this->get_editor_inline_format_change_operation( 'summary', array( 'bold', 'italic', 'strikethrough' ) ),
							)
						),
					),
				),
			),
		);
	}
}

class MWPSFE_Handler_Core_Table extends MWPSFE_Abstract_Text_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	public function id()                { return 'core_table'; }
	public function title()             { return 'Edit Table'; }
	public function element_type()      { return 'Table'; }
	public function element_type_code() { return 'table'; }
	public function description()       { return 'Edit this table.'; }
	public function call_to_action()    { return 'Click to edit this table.'; }

	public function get_supported_blocks() {
		return array( 'core/table' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Table();
	}

	/**
	 * Minimal strict schema contract.
	 *
	 * Top-level keys:
	 * - version (int)
	 * - block (object)
	 * - components (array<object>)
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );
		$attribute_capabilities     = array(
			'align' => array(
				'attribute'  => 'align',
				'values'     => array( 'none', 'wide', 'full', 'left', 'center', 'right' ),
				'unsetValue' => 'none',
			),
			'columnAlignment' => array(
				'attribute'  => 'columnAlignment',
				'values'     => array( 'left', 'center', 'right' ),
				'unsetValue' => 'left',
			),
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/table',
				'type' => 'text',
			),
			'components' => array(
				array(
					'id'          => 'table_head_cell',
					'label'       => 'Header Cell',
					'type'        => 'text',
					'selector'    => 'table thead tr > th',
					'default'     => true,
					'placeholder' => 'Header label',
					'repeat'      => array(
						'rowSelector'  => 'table thead tr',
						'cellSelector' => 'th',
					),
					'bindings' => array(
						array(
							'path'   => 'head.{row}.cells.{column}.content',
							'source' => 'html',
						),
						array(
							'path'   => 'head.{row}.cells.{column}.align',
							'source' => 'columnAlignment',
						),
					),
					'editor' => array(
						'enterMode' => 'linebreak',
						'tabMode'   => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats'   => array(
							array( 'undo', 'redo' ),
							array( 'align', 'textAlignment' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'attributeCapabilities'    => $attribute_capabilities,
						'formatTargets' => array(
							'align'           => 'block',
							'columnAlignment' => array(
								'scope'      => 'column',
								'selector'   => 'table tr > *',
								'contextKey' => 'column',
							),
						),
						'operations' => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'table_head_cell', $attribute_capabilities['align'] ),
								$this->get_editor_block_attribute_change_operation( 'set_text_align', 'table_head_cell', $attribute_capabilities['columnAlignment'] ),
								$this->get_editor_block_attribute_change_operation( 'set_column_align', 'table_head_cell', $attribute_capabilities['columnAlignment'] ),
								$this->get_editor_text_rewrite_operation( 'table_head_cell' ),
								$this->get_editor_inline_format_change_operation( 'table_head_cell', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'table_head_cell', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
				array(
					'id'          => 'table_body_cell',
					'label'       => 'Body Cell',
					'type'        => 'text',
					'selector'    => 'table tbody tr > td',
					'placeholder' => 'Add text',
					'repeat'      => array(
						'rowSelector'  => 'table tbody tr',
						'cellSelector' => 'td',
					),
					'bindings' => array(
						array(
							'path'   => 'body.{row}.cells.{column}.content',
							'source' => 'html',
						),
						array(
							'path'   => 'body.{row}.cells.{column}.align',
							'source' => 'columnAlignment',
						),
					),
					'editor' => array(
						'enterMode' => 'linebreak',
						'tabMode'   => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'align', 'textAlignment' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'attributeCapabilities'    => $attribute_capabilities,
						'formatTargets' => array(
							'align'           => 'block',
							'columnAlignment' => array(
								'scope'      => 'column',
								'selector'   => 'table tr > *',
								'contextKey' => 'column',
							),
						),
						'operations' => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'table_body_cell', $attribute_capabilities['align'] ),
								$this->get_editor_block_attribute_change_operation( 'set_text_align', 'table_body_cell', $attribute_capabilities['columnAlignment'] ),
								$this->get_editor_block_attribute_change_operation( 'set_column_align', 'table_body_cell', $attribute_capabilities['columnAlignment'] ),
								$this->get_editor_text_rewrite_operation( 'table_body_cell' ),
								$this->get_editor_inline_format_change_operation( 'table_body_cell', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'table_body_cell', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
				array(
					'id'          => 'table_foot_cell',
					'label'       => 'Footer Cell',
					'type'        => 'text',
					'selector'    => 'table tfoot tr > td',
					'placeholder' => 'Footer label',
					'repeat'      => array(
						'rowSelector'  => 'table tfoot tr',
						'cellSelector' => 'td',
					),
					'bindings' => array(
						array(
							'path'   => 'foot.{row}.cells.{column}.content',
							'source' => 'html',
						),
						array(
							'path'   => 'foot.{row}.cells.{column}.align',
							'source' => 'columnAlignment',
						),
					),
					'editor' => array(
						'enterMode' => 'linebreak',
						'tabMode'   => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'align', 'textAlignment' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'attributeCapabilities'    => $attribute_capabilities,
						'formatTargets' => array(
							'align'           => 'block',
							'columnAlignment' => array(
								'scope'      => 'column',
								'selector'   => 'table tr > *',
								'contextKey' => 'column',
							),
						),
						'operations' => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'table_foot_cell', $attribute_capabilities['align'] ),
								$this->get_editor_block_attribute_change_operation( 'set_text_align', 'table_foot_cell', $attribute_capabilities['columnAlignment'] ),
								$this->get_editor_block_attribute_change_operation( 'set_column_align', 'table_foot_cell', $attribute_capabilities['columnAlignment'] ),
								$this->get_editor_text_rewrite_operation( 'table_foot_cell' ),
								$this->get_editor_inline_format_change_operation( 'table_foot_cell', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'table_foot_cell', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
				array(
					'id'          => 'table_caption',
					'label'       => 'Caption',
					'type'        => 'text',
					'selector'    => 'figcaption',
					'placeholder' => 'Add caption',
					'missingUI'   => array(
						'mode'          => 'ghost',
						'mountSelector' => 'figure',
						'placement'     => 'append',
						'tag'           => 'figcaption',
						'attributes'    => array(
							'class' => 'wp-element-caption',
						),
					),
					'bindings' => array(
						array(
							'path'   => 'caption',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'never',
						'tabMode'   => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_text_rewrite_operation( 'table_caption' ),
								$this->get_editor_inline_format_change_operation( 'table_caption', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'table_caption', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}

}

class MWPSFE_Handler_Core_Image extends MWPSFE_Abstract_Schema_Media_Edit_Handler {

	public function id()                { return 'core_image'; }
	public function title()             { return 'Edit Image'; }
	public function element_type()      { return 'Image'; }
	public function element_type_code() { return 'image'; }
	public function description()       { return 'Edit this image block.'; }
	public function call_to_action()    { return 'Click to edit this image block.'; }

	public function get_supported_blocks() {
		return array( 'core/image' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Image();
	}

	/**
	 * Minimal strict schema contract for core/image.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );
		$align_attribute_capability = array(
			'attribute'  => 'align',
			'values'     => array( 'none', 'wide', 'full', 'left', 'center', 'right' ),
			'unsetValue' => 'none',
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/image',
				'type' => 'media',
			),
			'components' => array(
				array(
					'id'       => 'image',
					'label'    => 'Image',
					'type'     => 'file',
					'selector' => 'img',
					'default'  => true,
					'target'   => array(
						'selector'  => ':self',
						'attribute' => 'src',
						'mediaType' => 'image',
					),
					'bindings' => array(
						array(
							'path'     => 'url',
							'source'   => 'url',
							'resolved' => true,
						),
						array(
							'path'   => 'id',
							'source' => 'id',
						),
					),
					'editor' => array(
						'tabMode' => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							'align',
							'replaceMedia',
						),
						'formatTargets' => array(
							'align' => 'block',
						),
						'attributeCapabilities' => array(
							'align' => $align_attribute_capability,
						),
						'operations' => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'image', $align_attribute_capability ),
							)
						),
					),
				),
				array(
					'id'          => 'caption',
					'label'       => 'Caption',
					'type'        => 'text',
					'selector'    => 'figcaption',
					'placeholder' => 'Add caption',
					'missingUI'   => array(
						'mode'          => 'ghost',
						'mountSelector' => 'figure',
						'placement'     => 'append',
						'tag'           => 'figcaption',
						'attributes'    => array(
							'class' => 'wp-element-caption',
						),
					),
					'bindings' => array(
						array(
							'path'   => 'caption',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'never',
						'tabMode'   => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_text_rewrite_operation( 'caption' ),
								$this->get_editor_inline_format_change_operation( 'caption', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'caption', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/icon edit handler.
 *
 * The Icon block stores an icon-library identifier in its `icon` attribute;
 * it does not reference a media attachment. The shared schema media host uses
 * the `icon` media type to open WordPress' icon-library REST collection.
 */
class MWPSFE_Handler_Core_Icon extends MWPSFE_Abstract_Schema_Media_Edit_Handler {

	public function id()                { return 'core_icon'; }
	public function title()             { return 'Edit Icon'; }
	public function element_type()      { return 'Icon'; }
	public function element_type_code() { return 'icon'; }
	public function description()       { return 'Edit this icon block.'; }
	public function call_to_action()    { return 'Click to edit this icon block.'; }

	public function get_supported_blocks() {
		return array( 'core/icon' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Icon();
	}

	/**
	 * Declare icon replacement and block alignment for core/icon.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$align_attribute_capability = array(
			'attribute'  => 'align',
			'values'     => array( 'none', 'left', 'center', 'right' ),
			'unsetValue' => 'none',
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/icon',
				'type' => 'media',
			),
			'components' => array(
				array(
					'id'       => 'icon',
					'label'    => 'Icon',
					'type'     => 'file',
					'selector' => '.wp-block-icon svg',
					'default'  => true,
					'target'   => array(
						'selector'  => ':self',
						'attribute' => 'data-mwp-sfe-selected-icon',
						'mediaType' => 'icon',
					),
					'bindings' => array(
						array(
							'path'   => 'icon',
							'source' => 'url',
						),
					),
					'editor' => array(
						'tabMode' => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							'align',
							'replaceMedia',
						),
						'formatTargets' => array(
							'align' => 'block',
						),
						'attributeCapabilities' => array(
							'align' => $align_attribute_capability,
						),
						'operations' => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'icon', $align_attribute_capability ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/file edit handler.
 *
 * Declares a root-level file replacement component plus text components for the
 * inline link label and optional download button label.
 */
class MWPSFE_Handler_Core_File extends MWPSFE_Abstract_Schema_Media_Edit_Handler {

	public function id()                { return 'core_file'; }
	public function title()             { return 'Edit File'; }
	public function element_type()      { return 'File'; }
	public function element_type_code() { return 'file'; }
	public function description()       { return 'Edit this file block.'; }
	public function call_to_action()    { return 'Click to edit this file block.'; }

	public function get_supported_blocks() {
		return array( 'core/file' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_File();
	}

	/**
	 * Minimal strict schema contract for core/file.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough' ) );
		$align_attribute_capability = array(
			'attribute'  => 'align',
			'values'     => array( 'none', 'wide', 'full', 'left', 'center', 'right' ),
			'unsetValue' => 'none',
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/file',
				'type' => 'media',
			),
			'components' => array(
				array(
					'id'       => 'file',
					'label'    => 'File',
					'type'     => 'file',
					'selector' => '.wp-block-file',
					'default'  => true,
					'target'   => array(
						'selector'  => 'a',
						'attribute' => 'href',
						'mediaType' => 'file',
					),
					'bindings'  => array(
						array(
							'path'   => 'href',
							'source' => 'url',
						),
						array(
							'path'   => 'textLinkHref',
							'source' => 'url',
						),
						array(
							'path'   => 'id',
							'source' => 'id',
						),
					),
					'editor' => array(
						'tabMode' => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							'align',
							'replaceMedia',
						),
						'formatTargets' => array(
							'align' => 'block',
						),
						'attributeCapabilities' => array(
							'align' => $align_attribute_capability,
						),
						'operations' => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'file', $align_attribute_capability ),
							)
						),
					),
				),
				array(
					'id'          => 'link_text',
					'label'       => 'Link Text',
					'type'        => 'text',
					'selector'    => '.wp-block-file > a:not(.wp-block-file__button)',
					'required'    => true,
					'placeholder' => 'Write file name...',
					'bindings'    => array(
						array(
							'path'   => 'fileName',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode'  => 'never',
						'linkUIMode' => 'manual',
						'tabMode'    => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'bold', 'italic', 'strikethrough' ),
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_text_rewrite_operation( 'text' ),
								$this->get_editor_inline_format_change_operation( 'text', array( 'bold', 'italic', 'strikethrough' ) ),
							)
						),
					),
				),
				array(
					'id'          => 'button_text',
					'label'       => 'Button Text',
					'type'        => 'text',
					'selector'    => '.wp-block-file > a.wp-block-file__button',
					'placeholder' => 'Add text...',
					'required'    => true,
					'bindings'    => array(
						array(
							'path'   => 'downloadButtonText',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode'  => 'never',
						'linkUIMode' => 'manual',
						'tabMode'    => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'bold', 'italic', 'strikethrough' ),
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_text_rewrite_operation( 'button_text' ),
								$this->get_editor_inline_format_change_operation( 'button_text', array( 'bold', 'italic', 'strikethrough' ) ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/audio edit handler.
 */
class MWPSFE_Handler_Core_Audio extends MWPSFE_Abstract_Schema_Media_Edit_Handler {

	public function id()                { return 'core_audio'; }
	public function title()             { return 'Edit Audio'; }
	public function element_type()      { return 'Audio'; }
	public function element_type_code() { return 'audio'; }
	public function description()       { return 'Edit this audio block.'; }
	public function call_to_action()    { return 'Click to edit this audio block.'; }

	public function get_supported_blocks() {
		return array( 'core/audio' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Audio();
	}

	/**
	 * Minimal strict schema contract for core/audio.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );
		$align_attribute_capability = array(
			'attribute'  => 'align',
			'values'     => array( 'none', 'wide', 'full', 'left', 'center', 'right' ),
			'unsetValue' => 'none',
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/audio',
				'type' => 'media',
			),
			'components' => array(
				array(
					'id'       => 'audio',
					'label'    => 'Audio',
					'type'     => 'file',
					'selector' => 'audio',
					'default'  => true,
					'target'   => array(
						'selector'  => ':self',
						'attribute' => 'src',
						'mediaType' => 'audio',
					),
					'bindings' => array(
						array(
							'path'   => 'src',
							'source' => 'url',
						),
						array(
							'path'   => 'id',
							'source' => 'id',
						),
					),
					'editor' => array(
						'tabMode' => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							'align',
							'replaceMedia',
						),
						'formatTargets' => array(
							'align' => 'block',
						),
						'attributeCapabilities' => array(
							'align' => $align_attribute_capability,
						),
						'operations' => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'audio', $align_attribute_capability ),
							)
						),
					),
				),
				array(
					'id'          => 'caption',
					'label'       => 'Caption',
					'type'        => 'text',
					'selector'    => 'figcaption',
					'placeholder' => 'Add caption',
					'missingUI'   => array(
						'mode'          => 'ghost',
						'mountSelector' => 'figure',
						'placement'     => 'append',
						'tag'           => 'figcaption',
						'attributes'    => array(
							'class' => 'wp-element-caption',
						),
					),
					'bindings' => array(
						array(
							'path'   => 'caption',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'never',
						'tabMode'   => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_text_rewrite_operation( 'caption' ),
								$this->get_editor_inline_format_change_operation( 'caption', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'caption', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/video edit handler.
 */
class MWPSFE_Handler_Core_Video extends MWPSFE_Abstract_Schema_Media_Edit_Handler {

	public function id()                { return 'core_video'; }
	public function title()             { return 'Edit Video'; }
	public function element_type()      { return 'Video'; }
	public function element_type_code() { return 'video'; }
	public function description()       { return 'Edit this video block.'; }
	public function call_to_action()    { return 'Click to edit this video block.'; }

	public function get_supported_blocks() {
		return array( 'core/video' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Video();
	}

	/**
	 * Minimal strict schema contract for core/video.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$inline_format_capabilities = $this->get_inline_format_capabilities( array( 'bold', 'italic', 'strikethrough', 'link' ) );
		$align_attribute_capability = array(
			'attribute'  => 'align',
			'values'     => array( 'none', 'wide', 'full', 'left', 'center', 'right' ),
			'unsetValue' => 'none',
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/video',
				'type' => 'media',
			),
			'components' => array(
				array(
					'id'       => 'video',
					'label'    => 'Video',
					'type'     => 'file',
					'selector' => 'video',
					'default'  => true,
					'target'   => array(
						'selector'  => ':self',
						'attribute' => 'src',
						'mediaType' => 'video',
					),
					'bindings' => array(
						array(
							'path'   => 'src',
							'source' => 'url',
						),
						array(
							'path'   => 'id',
							'source' => 'id',
						),
					),
					'editor' => array(
						'tabMode' => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							'align',
							'replaceMedia',
						),
						'formatTargets' => array(
							'align' => 'block',
						),
						'attributeCapabilities' => array(
							'align' => $align_attribute_capability,
						),
						'operations' => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'video', $align_attribute_capability ),
							)
						),
					),
				),
				array(
					'id'          => 'caption',
					'label'       => 'Caption',
					'type'        => 'text',
					'selector'    => 'figcaption',
					'placeholder' => 'Add caption',
					'missingUI'   => array(
						'mode'          => 'ghost',
						'mountSelector' => 'figure',
						'placement'     => 'append',
						'tag'           => 'figcaption',
						'attributes'    => array(
							'class' => 'wp-element-caption',
						),
					),
					'bindings' => array(
						array(
							'path'   => 'caption',
							'source' => 'html',
						),
					),
					'editor' => array(
						'enterMode' => 'never',
						'tabMode'   => array(
							'tab'      => 'nextComponent',
							'shiftTab' => 'previousComponent',
						),
						'formats' => array(
							array( 'undo', 'redo' ),
							array( 'bold', 'italic', 'strikethrough' ),
							'link',
						),
						'inlineFormatCapabilities' => $inline_format_capabilities,
						'operations'               => $this->normalize_editor_operations(
							array(
								$this->get_editor_text_rewrite_operation( 'caption' ),
								$this->get_editor_inline_format_change_operation( 'caption', array( 'bold', 'italic', 'strikethrough' ) ),
								$this->get_editor_inline_attribute_change_operation( 'caption', 'link', $inline_format_capabilities ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/cover edit handler.
 *
 * Uses schema-declared media bindings while preserving container surgical save
 * semantics through the media-container ancestry.
 */
class MWPSFE_Handler_Core_Cover extends MWPSFE_Abstract_Schema_Media_Container_Edit_Handler {

	public function id()                { return 'core_cover'; }
	public function title()             { return 'Edit Cover'; }
	public function element_type()      { return 'Cover'; }
	public function element_type_code() { return 'cover'; }
	public function description()       { return 'Edit this cover block.'; }
	public function call_to_action()    { return 'Click to edit the cover block.'; }

	public function get_supported_blocks() {
		return array( 'core/cover' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Cover();
	}

	/**
	 * Minimal strict schema contract for core/cover.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$align_attribute_capability = array(
			'attribute'  => 'align',
			'values'     => array( 'none', 'wide', 'full', 'left', 'center', 'right' ),
			'unsetValue' => 'none',
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/cover',
				'type' => 'media',
			),
			'components' => array(
				array(
					'id'       => 'background',
					'label'    => 'Background',
					'type'     => 'file',
					'selector' => '.wp-block-cover__image-background, .wp-block-cover__video-background',
					'default'  => true,
					'target'   => array(
						'selector'  => ':self',
						'attribute' => 'src',
						'mediaType' => 'image_or_video',
					),
					'bindings' => array(
						array(
							'path'   => 'url',
							'source' => 'url',
						),
						array(
							'path'   => 'id',
							'source' => 'id',
						),
						array(
							'path'   => 'backgroundType',
							'source' => 'media_type',
						),
					),
					'editor' => array(
						'formats' => array(
							array( 'undo', 'redo' ),
							'align',
							'replaceMedia',
						),
						'formatTargets' => array(
							'align' => 'block',
						),
						'attributeCapabilities' => array(
							'align' => $align_attribute_capability,
						),
						'operations' => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'background', $align_attribute_capability ),
							)
						),
					),
				),
			),
		);
	}
}

/**
 * Schema-driven core/media-text edit handler.
 *
 * Uses schema-declared media bindings while preserving container surgical save
 * semantics through the media-container ancestry.
 */
class MWPSFE_Handler_Core_Media_Text extends MWPSFE_Abstract_Schema_Media_Container_Edit_Handler {

	public function id()                { return 'core_media_text'; }
	public function title()             { return 'Edit Media'; }
	public function element_type()      { return 'Media & Text'; }
	public function element_type_code() { return 'media-text'; }
	public function description()       { return 'Edit this media-text block.'; }
	public function call_to_action()    { return 'Click to edit this media-text block.'; }

	public function get_supported_blocks() {
		return array( 'core/media-text' );
	}

	public function get_comment_handler() {
		return new MWPSFE_Handler_Comment_Core_Media_Text();
	}

	/**
	 * Minimal strict schema contract for core/media-text.
	 *
	 * @return array
	 */
	public function get_schema_definition() {
		$align_attribute_capability = array(
			'attribute'  => 'align',
			'values'     => array( 'none', 'wide', 'full' ),
			'unsetValue' => 'none',
		);

		return array(
			'version' => 1,
			'block'   => array(
				'name' => 'core/media-text',
				'type' => 'media',
			),
			'components' => array(
				array(
					'id'       => 'media',
					'label'    => 'Media',
					'type'     => 'file',
					'selector' => 'figure.wp-block-media-text__media',
					'default'  => true,
					'target'   => array(
						'selector'  => 'img, video',
						'attribute' => 'src',
						'mediaType' => 'image_or_video',
					),
					'bindings' => array(
						array(
							'path'   => 'mediaUrl',
							'source' => 'url',
						),
						array(
							'path'   => 'mediaId',
							'source' => 'id',
						),
						array(
							'path'   => 'mediaType',
							'source' => 'media_type',
						),
					),
					'editor' => array(
						'formats' => array(
							array( 'undo', 'redo' ),
							'align',
							'replaceMedia',
						),
						'formatTargets' => array(
							'align' => 'block',
						),
						'attributeCapabilities' => array(
							'align' => $align_attribute_capability,
						),
						'operations' => $this->normalize_editor_operations(
							array(
								$this->get_editor_block_attribute_change_operation( 'set_align', 'media', $align_attribute_capability ),
							)
						),
					),
				),
			),
		);
	}
}
