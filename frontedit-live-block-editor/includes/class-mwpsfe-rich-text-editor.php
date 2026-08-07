<?php
/**
 * Rich Text Editor Integration
 * Uses custom inline editor
 */

namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_Rich_Text_Editor {

	private static $instance;

	public static function instance() {
		if ( ! self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Initialize hooks
	 */
	public function init() {
		// Runtime enqueue is centralized in MWPSFE_Assets so permissions are
		// enforced consistently from a single frontend gate.
	}

	/**
	 * Sanitize HTML from rich text editor
	 * Allows safe HTML tags while stripping dangerous content
	 * PRESERVES all classes, IDs, and other attributes needed by block editor
	 */
	public static function sanitize_rich_text( $content ) {
		// BYPASS FOR TRUSTED USERS
		// If the user is trusted (Admin/Editor), trust their HTML/CSS fully.
		// This allows rgba(), calc(), gradients, and other complex CSS that wp_kses strips.
		if ( current_user_can( 'unfiltered_html' ) ) {
			return $content;
		}

		// Otherwise, run the existing strict sanitization for lower-level users
		add_filter( 'safe_style_css', function( $styles ) {
			$additional_styles = array(
				'color',
				'background-color',
				'background',
				'text-align',
				'font-size',
				'font-weight',
				'font-style',
				'text-decoration',
				'display',
				'opacity'
			);
			return array_merge( $styles, $additional_styles );
		}, 10, 1 );
		
		// Define allowed HTML tags and attributes
		$allowed_tags = array(
			'p' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'span' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
				'title'  => array(),
			),
			'strong' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'b' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'em' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'i' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'u' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'strike' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			's' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'mark' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
				'title'  => array(),
			),
			'code' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'small' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'sub' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'sup' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'kbd' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'h1' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'h2' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'h3' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'h4' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'h5' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'h6' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'ul' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'ol' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'li' => array(
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'a' => array(
				'href'   => array(),
				'title'  => array(),
				'target' => array(),
				'rel'    => array(),
				'class'  => array(),
				'id'     => array(),
				'style'  => array(),
				'data-*' => true,
			),
			'br' => array(),
		);
		
		// Use wp_kses for safe HTML filtering
		$content = wp_kses( $content, $allowed_tags );
		
		// Remove the filter after use
		remove_all_filters( 'safe_style_css' );
		
		// Additional cleanup
		$content = trim( $content );
		
		return $content;
	}
	
	/**
	 * Convert HTML to plain text
	 */
	public static function strip_to_plain_text( $content ) {
		return wp_strip_all_tags( $content );
	}
}
