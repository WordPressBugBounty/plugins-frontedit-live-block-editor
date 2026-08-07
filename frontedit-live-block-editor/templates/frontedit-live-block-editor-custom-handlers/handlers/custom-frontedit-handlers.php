<?php
namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Example paragraph comment handler loaded from a custom plugin.
 *
 * Rename the PHP class names in this file before using it.
 * Handler IDs may stay the same if you intentionally want to override an
 * existing built-in handler registration.
 */
class MWPSFE_Example_Handler_Comment_Paragraph extends MWPSFE_Abstract_Text_Comment_Handler {

	/**
	 * Return the handler ID.
	 *
	 * @return string
	 */
	public function id() {
		return 'comment_paragraph';
	}

	/**
	 * Return the human-readable element type.
	 *
	 * @return string
	 */
	public function element_type() {
		return 'Paragraph';
	}

	/**
	 * Return the element type code.
	 *
	 * @return string
	 */
	public function element_type_code() {
		return 'paragraph';
	}

	/**
	 * Return the handler description.
	 *
	 * @return string
	 */
	public function description() {
		return 'Comment on this paragraph.';
	}

	/**
	 * Return the click prompt shown in the UI.
	 *
	 * @return string
	 */
	public function call_to_action() {
		return 'Click to add a comment for this paragraph.';
	}

	/**
	 * Return the Gutenberg blocks supported by this handler.
	 *
	 * @return array<int, string>
	 */
	public function get_supported_blocks() {
		return array( 'core/paragraph' );
	}
}

/**
 * Example paragraph edit handler loaded from a custom plugin.
 *
 * This mirrors the built-in paragraph handler so developers have a copyable
 * example showing that external subclasses can still call helper methods from
 * FrontEdit's abstract base classes.
 */
class MWPSFE_Example_Handler_Core_Paragraph extends MWPSFE_Abstract_Text_Edit_Handler implements MWPSFE_Schema_Handler_Interface {

	/**
	 * Return the handler ID.
	 *
	 * @return string
	 */
	public function id() {
		return 'core_paragraph';
	}

	/**
	 * Return the handler title.
	 *
	 * @return string
	 */
	public function title() {
		return 'Edit Paragraph';
	}

	/**
	 * Return the human-readable element type.
	 *
	 * @return string
	 */
	public function element_type() {
		return 'Paragraph';
	}

	/**
	 * Return the element type code.
	 *
	 * @return string
	 */
	public function element_type_code() {
		return 'paragraph';
	}

	/**
	 * Return the handler description.
	 *
	 * @return string
	 */
	public function description() {
		return 'Edit this paragraph.';
	}

	/**
	 * Return the click prompt shown in the UI.
	 *
	 * @return string
	 */
	public function call_to_action() {
		return 'Click to edit this paragraph.';
	}

	/**
	 * Return the Gutenberg blocks supported by this handler.
	 *
	 * @return array<int, string>
	 */
	public function get_supported_blocks() {
		return array( 'core/paragraph' );
	}

	/**
	 * Return the companion comment handler.
	 *
	 * @return MWPSFE_Handler_Interface
	 */
	public function get_comment_handler() {
		return new MWPSFE_Example_Handler_Comment_Paragraph();
	}

	/**
	 * Return the schema contract for the paragraph block.
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
							'align',
							'textAlignment',
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
