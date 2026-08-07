<?php
/**
 * FrontEdit Block Renderer
 *
 * Single canonical renderer for all block display throughout the plugin -
 * admin catalog, content requests UI, dashboard, and emails.
 *
 * Admin rendering
 * ───────────────
 * Uses the same WP/global block CSS as the frontend (wp_get_global_stylesheet
 * + block library base styles). The CSS is exposed for page-level enqueue so
 * preview HTML remains markup-only and AJAX history loads never inject global
 * <style> tags into the DOM.
 *
 * Email rendering
 * ───────────────
 * Email clients handle styles inconsistently regardless of approach, so block
 * HTML is returned as-is inside a neutral wrapper.  A disclaimer in the email
 * template covers any rendering differences.
 *
 * Media blocks
 * ────────────
 * Image, audio, video, file, cover, and media-text blocks are always rendered
 * as a badge + filename pill so they display meaningfully in both contexts.
 */

namespace MWPSFE;

use DOMDocument;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_Block_Renderer {

	// -------------------------------------------------------------------------
	// Configuration
	// -------------------------------------------------------------------------

	/**
	 * Registry of media blocks, lazily built on first render() call by
	 * ensure_media_registry() which pulls directly from the handlers.
	 *
	 * Each entry maps a block name to metadata used by the simplified media-card
	 * renderer. Primary file lookup remains URL-driven, while optional detail rows
	 * are derived from schema-declared text components when available.
	 *
	 * Each entry maps a block name to an array with these keys:
	 *   'url_attr'   - block attribute key holding the primary media URL,
	 *                  e.g. 'url' (image), 'src' (audio/video), 'mediaUrl' (media-text).
	 *                  Used as the fast primary lookup: $block['attrs'][$url_attr].
	 *   'media_attr' - HTML attribute on the media element that carries the URL,
	 *                  e.g. 'src' or 'href'.  Used together with media_tags to build
	 *                  a tag-specific fallback regex.
	 *   'media_tags' - HTML tags to search when the block attr is absent,
	 *                  e.g. ['img'], ['audio'], ['a'], or ['img','video'] for
	 *                  cover/media-text which can hold either element type.
	 *   'type_label' - human-friendly block type label for the summary badge.
	 *   'detail_components' - schema-declared text components rendered as optional
	 *                  detail rows beneath the file summary.
	 *
	 * @var array<string, array{
	 *   url_attr: string,
	 *   media_attr: string,
	 *   media_tags: string[],
	 *   type_label: string,
	 *   detail_components: array<int, array{id: string, label: string, selector: string}>
	 * }>
	 */
	private static array $media_block_info = [];

	/** Transient key for the compiled stylesheet. */
	const CACHE_KEY = 'mwpsfe_block_styles_v1';

	/** Cache lifetime - invalidated on theme switch or upgrade. */
	const CACHE_TTL = DAY_IN_SECONDS;

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/**
	 * Render serialized WP block markup for display in admin or email.
	 *
	 * @param string $serialized  Serialized WP block markup (from serialize_block()).
	 * @param string $context     'admin' | 'email'
	 * @param string $page_url    Optional post permalink (used for media pill links).
	 * @param string $uuid        Optional block UUID, appended as anchor to $page_url.
	 * @return string             Rendered HTML ready for insertion.
	 */
	public static function render(
		string $serialized,
		bool   $for_email = false,
		string $page_url = '',
		string $uuid     = ''
	): string {
		if ( empty( trim( $serialized ) ) ) {
			return '';
		}

		// Map the boolean to the internal string context
        $context = $for_email ? 'email' : 'admin';

		self::ensure_media_registry();

		$blocks = parse_blocks( $serialized );
		foreach ( $blocks as $block ) {
			if ( empty( $block['blockName'] ) ) {
				continue;
			}
			// Pass the derived context string to the internal dispatcher
			return self::render_block_item( $block, $context, $page_url, $uuid );
		}

		return '';
	}

	/**
	 * Return the admin preview stylesheet (block library + global styles) so it
	 * can be loaded once per admin page via wp_add_inline_style().
	 *
	 * @return string
	 */
	public static function get_admin_preview_styles(): string {
		return self::scope_css_to_preview_container( self::get_block_styles() );
	}

	/**
	 * Remove any <style> tags from preview HTML before sending AJAX payloads.
	 * Safety net only; admin previews should receive CSS via page-level enqueue.
	 *
	 * @param string $html
	 * @return string
	 */
	public static function strip_style_tags( string $html ): string {
		if ( '' === $html ) {
			return '';
		}

		return (string) preg_replace( '/<style\b[^>]*>.*?<\/style>/is', '', $html );
	}

	/**
	 * Scope raw CSS so it only affects preview markup rendered inside
	 * .mwp-sfe-block-preview containers.
	 *
	 * @param string $css
	 * @return string
	 */
	private static function scope_css_to_preview_container( string $css ): string {
		if ( '' === trim( $css ) ) {
			return '';
		}

		return self::scope_css_block( $css, '.mwp-sfe-block-preview' );
	}

	/**
	 * Recursively scope a CSS block. Regular selectors are prefixed; only at-rules
	 * that contain nested selectors are recursively processed.
	 *
	 * @param string $css
	 * @param string $scope
	 * @return string
	 */
	private static function scope_css_block( string $css, string $scope ): string {
		$out   = '';
		$len   = strlen( $css );
		$index = 0;

		while ( $index < $len ) {
			if ( substr( $css, $index, 2 ) === '/*' ) {
				$end = strpos( $css, '*/', $index + 2 );
				if ( $end === false ) {
					$out .= substr( $css, $index );
					break;
				}
				$out   .= substr( $css, $index, ( $end - $index ) + 2 );
				$index  = $end + 2;
				continue;
			}

			$start = $index;
			$paren_depth = 0;
			$quote       = '';

			while ( $index < $len ) {
				$ch = $css[ $index ];

				if ( '' !== $quote ) {
					if ( $ch === '\\' ) {
						$index += 2;
						continue;
					}
					if ( $ch === $quote ) {
						$quote = '';
					}
					$index++;
					continue;
				}

				if ( $ch === '"' || $ch === "'" ) {
					$quote = $ch;
					$index++;
					continue;
				}

				if ( $ch === '(' ) {
					$paren_depth++;
					$index++;
					continue;
				}

				if ( $ch === ')' && $paren_depth > 0 ) {
					$paren_depth--;
					$index++;
					continue;
				}

				if ( $paren_depth === 0 && ( $ch === '{' || $ch === ';' ) ) {
					break;
				}

				$index++;
			}

			if ( $index >= $len ) {
				$out .= substr( $css, $start );
				break;
			}

			$prelude   = trim( substr( $css, $start, $index - $start ) );
			$delimiter = $css[ $index ];

			if ( $delimiter === ';' ) {
				$out   .= substr( $css, $start, ( $index - $start ) + 1 );
				$index += 1;
				continue;
			}

			$block_end = self::find_matching_brace_index( $css, $index );
			if ( $block_end === null ) {
				$out .= substr( $css, $start );
				break;
			}

			$inner = substr( $css, $index + 1, $block_end - $index - 1 );
			$is_at = isset( $prelude[0] ) && $prelude[0] === '@';

			if ( $is_at ) {
				if ( self::at_rule_contains_nested_selectors( $prelude ) ) {
					$inner = self::scope_css_block( $inner, $scope );
				}
				$out .= $prelude . '{' . $inner . '}';
			} else {
				$out .= self::scope_selector_list( $prelude, $scope ) . '{' . $inner . '}';
			}

			$index = $block_end + 1;
		}

		return $out;
	}

	/**
	 * Find the matching closing brace for a block starting at $open_index.
	 *
	 * @param string $css
	 * @param int    $open_index
	 * @return int|null
	 */
	private static function find_matching_brace_index( string $css, int $open_index ): ?int {
		$len   = strlen( $css );
		$depth = 0;
		$quote = '';

		for ( $i = $open_index; $i < $len; $i++ ) {
			$ch = $css[ $i ];

			if ( '' !== $quote ) {
				if ( $ch === '\\' ) {
					$i++;
					continue;
				}
				if ( $ch === $quote ) {
					$quote = '';
				}
				continue;
			}

			if ( substr( $css, $i, 2 ) === '/*' ) {
				$end = strpos( $css, '*/', $i + 2 );
				if ( $end === false ) {
					return null;
				}
				$i = $end + 1;
				continue;
			}

			if ( $ch === '"' || $ch === "'" ) {
				$quote = $ch;
				continue;
			}

			if ( $ch === '{' ) {
				$depth++;
				continue;
			}

			if ( $ch === '}' ) {
				$depth--;
				if ( $depth === 0 ) {
					return $i;
				}
			}
		}

		return null;
	}

	/**
	 * Only these at-rules are expected to contain nested selector blocks.
	 *
	 * @param string $prelude
	 * @return bool
	 */
	private static function at_rule_contains_nested_selectors( string $prelude ): bool {
		$normalized = strtolower( ltrim( $prelude ) );
		return (bool) preg_match( '/^@(media|supports|container|layer|document)\b/', $normalized );
	}

	/**
	 * Scope a selector list (`a, b, c`) to the preview container.
	 *
	 * @param string $selector_list
	 * @param string $scope
	 * @return string
	 */
	private static function scope_selector_list( string $selector_list, string $scope ): string {
		$selectors   = [];
		$buffer      = '';
		$paren_depth = 0;
		$brkt_depth  = 0;
		$quote       = '';
		$chars       = preg_split( '//u', $selector_list, -1, PREG_SPLIT_NO_EMPTY );

		foreach ( $chars as $ch ) {
			if ( '' !== $quote ) {
				if ( $ch === $quote ) {
					$quote = '';
				}
				$buffer .= $ch;
				continue;
			}

			if ( $ch === '"' || $ch === "'" ) {
				$quote  = $ch;
				$buffer .= $ch;
				continue;
			}

			if ( $ch === '(' ) {
				$paren_depth++;
				$buffer .= $ch;
				continue;
			}
			if ( $ch === ')' && $paren_depth > 0 ) {
				$paren_depth--;
				$buffer .= $ch;
				continue;
			}
			if ( $ch === '[' ) {
				$brkt_depth++;
				$buffer .= $ch;
				continue;
			}
			if ( $ch === ']' && $brkt_depth > 0 ) {
				$brkt_depth--;
				$buffer .= $ch;
				continue;
			}

			if ( $ch === ',' && $paren_depth === 0 && $brkt_depth === 0 ) {
				$selectors[] = self::scope_single_selector( $buffer, $scope );
				$buffer      = '';
				continue;
			}

			$buffer .= $ch;
		}

		if ( trim( $buffer ) !== '' ) {
			$selectors[] = self::scope_single_selector( $buffer, $scope );
		}

		return implode( ', ', array_filter( $selectors ) );
	}

	/**
	 * Scope one selector by anchoring it to the preview container.
	 *
	 * @param string $selector
	 * @param string $scope
	 * @return string
	 */
	private static function scope_single_selector( string $selector, string $scope ): string {
		$selector = trim( $selector );
		if ( $selector === '' ) {
			return '';
		}

		$selector = preg_replace(
			'/(^|[\s>+~,(])(:root|html|body)(?=([\s>+~.#[:]|$))/i',
			'$1' . $scope,
			$selector
		);
		$selector = (string) preg_replace( '/\s+/', ' ', trim( (string) $selector ) );
		$scope_rx = '/' . preg_quote( $scope, '/' ) . '(?:\s+' . preg_quote( $scope, '/' ) . ')+/';
		$selector = (string) preg_replace( $scope_rx, $scope, $selector );

		if ( strpos( $selector, $scope ) === false ) {
			return $scope . ' ' . $selector;
		}

		return $selector;
	}

	/**
	 * Register WordPress hooks that keep the stylesheet cache fresh.
	 * Call once during plugin initialisation.
	 */
	public static function register_hooks(): void {
		add_action( 'switch_theme',              [ self::class, 'invalidate_cache' ] );
		add_action( 'upgrader_process_complete', [ self::class, 'invalidate_cache' ] );
	}

	/**
	 * Invalidate the cached stylesheet.
	 * Called automatically on theme switch / WP/plugin upgrade.
	 */
	public static function invalidate_cache(): void {
		delete_transient( self::CACHE_KEY );
	}

	// -------------------------------------------------------------------------
	// Media registry
	// -------------------------------------------------------------------------

	/**
	 * Lazily populate $media_block_info from the registered handlers.
	 *
	 * Only handlers that declare all three of get_block_url_attr(), get_media_attr(),
	 * and get_media_tags() (non-empty) are treated as media blocks; text and comment
	 * handlers are silently skipped.
	 */
	private static function ensure_media_registry(): void {
		if ( ! empty( self::$media_block_info ) ) {
			return;
		}

		$handler_registry = MWPSFE_Handler_Registry::instance();

		foreach ( $handler_registry->get_handlers() as $handler ) {
			if ( $handler->capability() !== 'edit' ) {
				continue;
			}

			// Only process handlers where the actual content is media
			if ( $handler->content_type() !== 'media' ) {
				continue;
			}

			$url_attr   = method_exists( $handler, 'get_block_url_attr' ) ? $handler->get_block_url_attr() : null;
			$media_attr = method_exists( $handler, 'get_media_attr' ) ? $handler->get_media_attr() : null;
			$media_tags = method_exists( $handler, 'get_media_tags' ) ? $handler->get_media_tags() : [];

			if ( $url_attr === null || $media_attr === null || empty( $media_tags ) ) {
				continue;
			}

			$type_label        = trim( (string) $handler->element_type() );
			$detail_components = self::get_schema_media_detail_components( $handler );

			foreach ( $handler->get_supported_blocks() as $block_name ) {
				self::$media_block_info[ $block_name ] = [
					'url_attr'          => $url_attr,
					'media_attr'        => $media_attr,
					'media_tags'        => $media_tags,
					'type_label'        => $type_label,
					'detail_components' => $detail_components,
				];
			}
		}
	}

	// -------------------------------------------------------------------------
	// Block dispatch
	// -------------------------------------------------------------------------

	private static function render_block_item(
		array  $block,
		string $context,
		string $page_url,
		string $uuid
	): string {
		$info = self::$media_block_info[ $block['blockName'] ] ?? null;

		if ( $info !== null ) {
			return self::render_media_block(
				$block,
				$info,
				$context
			);
		}

		return self::render_text_block( $block, $context );
	}

	// -------------------------------------------------------------------------
	// Media block rendering
	// -------------------------------------------------------------------------

	private static function render_media_block(
		array  $block,
		array  $info,
		string $context
	): string {
		$url        = self::extract_media_url(
			$block,
			(string) ( $info['url_attr'] ?? '' ),
			(string) ( $info['media_attr'] ?? '' ),
			(array) ( $info['media_tags'] ?? [] )
		);
		$type_label = trim( (string) ( $info['type_label'] ?? '' ) );
		if ( '' === $type_label ) {
			$type_label = ucwords( str_replace( ['core/', '-'], ['', ' & '], $block['blockName'] ) );
		}

		$filename   = $url ? basename( (string) wp_parse_url( $url, PHP_URL_PATH ) ) : '';
		$file_text  = $filename ?: 'No file';
		$details    = self::extract_media_detail_rows(
			$block,
			(array) ( $info['detail_components'] ?? [] )
		);

		if ( $context === 'email' ) {
			return self::render_media_block_email_card(
				$type_label,
				$file_text,
				$url,
				$details
			);
		}

		return self::render_media_block_admin_card(
			$type_label,
			$file_text,
			$url,
			$details
		);
	}

	/**
	 * Build a generic media summary card for admin previews.
	 *
	 * @param string $type_label
	 * @param string $file_text
	 * @param string $url
	 * @param array  $details
	 * @return string
	 */
	private static function render_media_block_admin_card(
		string $type_label,
		string $file_text,
		string $url,
		array  $details
	): string {
		$summary_open = $url
			? '<a class="mwp-sfe-media-summary" href="' . esc_url( $url ) . '" target="_blank" rel="noopener noreferrer">'
			: '<span class="mwp-sfe-media-summary is-missing">';
		$summary_close = $url ? '</a>' : '</span>';
		$summary_html  = $summary_open
			. '<span class="mwp-sfe-media-type-badge">' . esc_html( $type_label ) . '</span>'
			. '<span class="mwp-sfe-media-filename' . ( $url ? '' : ' is-missing' ) . '">' . esc_html( $file_text ) . '</span>'
			. $summary_close;

		if ( empty( $details ) ) {
			return '<div class="mwp-sfe-block-preview mwp-sfe-media-block-preview">'
				. $summary_html
				. '</div>';
		}

		return '<div class="mwp-sfe-block-preview mwp-sfe-media-block-preview">'
			. '<div class="mwp-sfe-media-card">'
			. $summary_html
			. self::render_media_detail_rows_admin_html( $details )
			. '</div>'
			. '</div>';
	}

	/**
	 * Build an email-safe media summary card with optional detail rows.
	 *
	 * @param string $type_label
	 * @param string $file_text
	 * @param string $url
	 * @param array  $details
	 * @return string
	 */
	private static function render_media_block_email_card(
		string $type_label,
		string $file_text,
		string $url,
		array  $details
	): string {
		// .mwp-sfe-media-summary
		$summary_open = $url
			? '<a href="' . esc_url( $url ) . '" target="_blank" rel="noopener noreferrer" style="display:inline-block;color:inherit;text-decoration:none;">'
			: '<span style="display:inline-block;">';
		$summary_close = $url ? '</a>' : '</span>';
		$summary_html  = $summary_open
			// .mwp-sfe-media-summary, .mwp-sfe-media-summary.is-missing
			. '<span style="display:inline-block;padding:6px;background:#f0f6fc;border:1px solid #b8d4f1;border-radius:3px;">'
			// .mwp-sfe-media-type-badge
			. '<span style="display:inline-block;vertical-align:middle;margin-right:6px;background:#2271b1;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 6px;border-radius:3px;white-space:nowrap;">'
			. esc_html( $type_label )
			. '</span>'
			// .mwp-sfe-media-filename, .mwp-sfe-media-filename.is-missing
			. '<span style="display:inline-block;vertical-align:middle;font-size:12px;color:' . ( $url ? '#2271b1' : '#787c82' ) . ';overflow-wrap:anywhere;word-break:break-all;' . ( $url ? 'text-decoration:underline;' : '' ) . '">'
			. esc_html( $file_text )
			. '</span>'
			. '</span>'
			. $summary_close;

		if ( empty( $details ) ) {
			// Wrapper <div class="mwp-sfe-block-preview mwp-sfe-media-block-preview"> rendered via MWPSFEPRO_Notifications
			return '<div style="display:inline-block;max-width:100%;">'
				. $summary_html
				. '</div>';
		}

		// Wrapper <div class="mwp-sfe-block-preview mwp-sfe-media-block-preview"> rendered via MWPSFEPRO_Notifications
		// .mwp-sfe-media-card
		return '<div style="display:inline-block;max-width:100%;padding:10px;background:#fff;border:1px solid #ccd0d4;border-radius:3px;box-shadow:0 2px 8px rgba(0,0,0,.05);">'
			. $summary_html
			. self::render_media_detail_rows_email_html( $details )
			. '</div>';
	}

	/**
	 * Render admin detail rows for schema-backed media components.
	 *
	 * @param array $details
	 * @return string
	 */
	private static function render_media_detail_rows_admin_html( array $details ): string {
		if ( empty( $details ) ) {
			return '';
		}

		$html = '<div class="mwp-sfe-media-card-details">';
		foreach ( $details as $detail ) {
			$html .= '<div class="mwp-sfe-media-card-detail">'
				. '<span class="mwp-sfe-media-card-label">' . esc_html( $detail['label'] ) . '</span>'
				. '<span class="mwp-sfe-media-card-value">' . esc_html( $detail['value'] ) . '</span>'
				. '</div>';
		}
		$html .= '</div>';

		return $html;
	}

	/**
	 * Render email-safe detail rows for schema-backed media components.
	 *
	 * @param array $details
	 * @return string
	 */
	private static function render_media_detail_rows_email_html( array $details ): string {
		if ( empty( $details ) ) {
			return '';
		}

		// .mwp-sfe-media-card-details
		$html = '<div style="margin-top:10px;">';
		foreach ( $details as $detail ) {
			// .mwp-sfe-media-card-detail
			$html .= '<div style="padding-top:8px;margin-top:8px;border-top:1px solid #f0f0f1;">'
				// .mwp-sfe-media-card-label
				. '<div style="margin-bottom:3px;font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#787c82;">'
				. esc_html( $detail['label'] )
				. '</div>'
				// .mwp-sfe-media-card-value
				. '<div style="font-size:12px;line-height:1.5;color:#1d2327;word-break:break-word;overflow-wrap:anywhere;">'
				. esc_html( $detail['value'] )
				. '</div>'
				. '</div>';
		}
		$html .= '</div>';

		return $html;
	}

	// -------------------------------------------------------------------------
	// Text / container block rendering
	// -------------------------------------------------------------------------

	/**
	 * Return schema-backed text components to expose as detail rows on media cards.
	 *
	 * @param MWPSFE_Handler_Interface $handler
	 * @return array<int, array{id: string, label: string, selector: string}>
	 */
	private static function get_schema_media_detail_components( MWPSFE_Handler_Interface $handler ): array {
		if ( ! $handler instanceof MWPSFE_Schema_Handler_Interface ) {
			return [];
		}

		$schema = (array) $handler->get_schema_definition();
		if ( empty( $schema['components'] ) || ! is_array( $schema['components'] ) ) {
			return [];
		}

		$components = [];

		foreach ( $schema['components'] as $component ) {
			if ( ! is_array( $component ) ) {
				continue;
			}

			$type     = strtolower( trim( (string) ( $component['type'] ?? '' ) ) );
			$selector = trim( (string) ( $component['selector'] ?? '' ) );
			if ( 'text' !== $type || '' === $selector ) {
				continue;
			}

			$bindings = isset( $component['bindings'] ) && is_array( $component['bindings'] )
				? $component['bindings']
				: [];
			$has_preview_binding = false;

			foreach ( $bindings as $binding ) {
				if ( ! is_array( $binding ) ) {
					continue;
				}

				$source = strtolower( trim( (string) ( $binding['source'] ?? '' ) ) );
				$path   = trim( (string) ( $binding['path'] ?? '' ) );
				if ( '' !== $path && ( 'html' === $source || 'plaintext' === $source ) ) {
					$has_preview_binding = true;
					break;
				}
			}

			if ( ! $has_preview_binding ) {
				continue;
			}

			$components[] = [
				'id'       => trim( (string) ( $component['id'] ?? 'component' ) ),
				'label'    => trim( (string) ( $component['label'] ?? $component['id'] ?? 'Details' ) ),
				'selector' => $selector,
			];
		}

		return $components;
	}

	/**
	 * Extract the canonical media URL for summary-link rendering.
	 *
	 * @param array    $block
	 * @param string   $url_attr
	 * @param string   $media_attr
	 * @param string[] $media_tags
	 * @return string
	 */
	private static function extract_media_url(
		array  $block,
		string $url_attr,
		string $media_attr,
		array  $media_tags
	): string {
		$url = $url_attr !== '' ? (string) ( $block['attrs'][ $url_attr ] ?? '' ) : '';

		if ( ! $url && ! empty( $block['innerHTML'] ) ) {
			if ( ! empty( $media_tags ) && $media_attr !== '' ) {
				$tags_re = implode( '|', array_map( 'preg_quote', $media_tags, array_fill( 0, count( $media_tags ), '/' ) ) );
				if ( count( $media_tags ) > 1 ) {
					$tags_re = '(?:' . $tags_re . ')';
				}
				$attr_re = preg_quote( $media_attr, '/' );
				$pattern = '/<' . $tags_re . '\b[^>]+\b' . $attr_re . '=["\']((https?:|\\/\\/)[^"\']+)["\']/i';
				if ( preg_match( $pattern, $block['innerHTML'], $m ) ) {
					$url = $m[1];
				}
			}

			// Additional fallback for CSS background-image (e.g. Cover block with fixed background)
			if ( ! $url && preg_match( '/background-image:\s*url\([\'"]?((https?:|\\/\\/)[^\'"]+)[\'"]?\)/i', $block['innerHTML'], $m ) ) {
				$url = $m[1];
			}
		}

		return is_string( $url ) ? trim( $url ) : '';
	}

	/**
	 * Extract schema-backed detail rows from serialized block markup.
	 *
	 * @param array $block
	 * @param array $components
	 * @return array<int, array{label: string, value: string}>
	 */
	private static function extract_media_detail_rows( array $block, array $components ): array {
		if ( empty( $components ) ) {
			return [];
		}

		$serialized = serialize_blocks( [ $block ] );
		$dom        = self::build_preview_dom_document( $serialized );
		if ( ! $dom ) {
			return [];
		}

		$details = [];
		foreach ( $components as $component ) {
			$selector = trim( (string) ( $component['selector'] ?? '' ) );
			if ( '' === $selector ) {
				continue;
			}

			$match = self::find_first_schema_selector_match( $dom, $selector );
			if ( ! $match ) {
				continue;
			}

			$value = self::normalize_preview_text( $match->textContent ?? '' );
			if ( '' === $value ) {
				continue;
			}

			$details[] = [
				'label' => trim( (string) ( $component['label'] ?? 'Details' ) ),
				'value' => $value,
			];
		}

		return $details;
	}

	/**
	 * Normalize preview text for compact card display.
	 *
	 * @param string $text
	 * @return string
	 */
	private static function normalize_preview_text( string $text ): string {
		return trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( $text ) ) );
	}

	/**
	 * Build a DOMDocument for schema preview extraction.
	 *
	 * @param string $html
	 * @return DOMDocument|null
	 */
	private static function build_preview_dom_document( string $html ): ?DOMDocument {
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
	private static function split_schema_selector_groups( string $selector ): array {
		$groups = [];
		$buffer = '';
		$depth  = 0;
		$chars  = preg_split( '//u', $selector, -1, PREG_SPLIT_NO_EMPTY );

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
	 * Tokenize a selector group into supported simple selectors plus combinators.
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
	 * @return array<int, array{combinator: string, selector: string}>
	 */
	private static function tokenize_schema_selector_group( string $selector ): array {
		$tokens = [];
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
					$tokens[] = [
						'combinator' => 'descendant',
						'selector'   => $part,
					];
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
					$tokens[] = [
						'combinator' => 'descendant',
						'selector'   => $part,
					];
					$buffer = '';
				}
				continue;
			}

			$buffer .= $char;
		}

		$part = trim( $buffer );
		if ( '' !== $part ) {
			$tokens[] = [
				'combinator' => 'descendant',
				'selector'   => $part,
			];
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
	private static function element_matches_schema_selector( \DOMElement $element, string $selector, \DOMElement $root ): bool {
		$selector = trim( $selector );
		if ( '' === $selector ) {
			return false;
		}

		if ( ':scope' === $selector || ':self' === $selector ) {
			return $element->isSameNode( $root );
		}

		$not_classes = [];
		if ( preg_match_all( '/:not\(\.([A-Za-z0-9_-]+)\)/', $selector, $not_matches ) ) {
			$not_classes = $not_matches[1];
			$selector    = preg_replace( '/:not\(\.[A-Za-z0-9_-]+\)/', '', $selector );
		}

		$selector = trim( $selector );
		if ( '' === $selector ) {
			$selector = '*';
		}

		$tag     = '*';
		$classes = [];

		if ( preg_match( '/^[A-Za-z][A-Za-z0-9_-]*|\*/', $selector, $tag_match ) ) {
			$tag = strtolower( $tag_match[0] );
		}

		if ( preg_match_all( '/\.([A-Za-z0-9_-]+)/', $selector, $class_matches ) ) {
			$classes = $class_matches[1];
		}

		if ( '*' !== $tag && strtolower( $element->tagName ) !== $tag ) {
			return false;
		}

		$class_attr = ' ' . preg_replace( '/\s+/', ' ', trim( $element->getAttribute( 'class' ) ) ) . ' ';
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
	private static function find_first_schema_selector_match( DOMDocument $dom, string $selector ): ?\DOMElement {
		$root = $dom->documentElement;
		if ( ! $root ) {
			return null;
		}

		foreach ( self::split_schema_selector_groups( $selector ) as $group ) {
			$current = [ $root ];
			$tokens  = self::tokenize_schema_selector_group( $group );
			if ( empty( $tokens ) ) {
				continue;
			}

			foreach ( $tokens as $index => $token ) {
				$next = [];
				foreach ( $current as $context ) {
					if ( ! $context instanceof \DOMElement ) {
						continue;
					}

					$candidates = [];
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
						if ( self::element_matches_schema_selector( $candidate, $token['selector'], $context ) ) {
							$next[] = $candidate;
						}
					}
				}

				if ( empty( $next ) ) {
					$current = [];
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

	private static function render_text_block( array $block, string $context ): string {
		$html = preg_replace(
			'/ data-mwp-sfe-uuid="[^"]*"/',
			'',
			render_block( $block )
		);

		if ( empty( trim( $html ) ) ) {
			return '';
		}

		if ( $context === 'email' ) {
			// Non-breaking spaces (U+00A0 / &nbsp;) from WP block rendering form
			// unbreakable runs that overflow fixed-width email layouts even when
			// overflow-wrap is set.  Replace them with regular spaces so the text
			// can wrap naturally.
			$html = str_replace( '&nbsp;', ' ', $html );
			$html = str_replace( "\xc2\xa0", ' ', $html ); // UTF-8 encoded U+00A0

			// Constrain images so they never exceed the container width.
			$html = preg_replace(
				'/<img\b([^>]*?)(?:\sstyle="([^"]*)")?([^>]*)>/i',
				'<img$1 style="max-width:100%;height:auto;display:block;$2"$3>',
				$html
			);

			return '<div style="'
				. 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;'
				. 'font-size:14px;line-height:1.6;color:#1d2327;'
				. 'word-break:break-word;overflow-wrap:anywhere;max-width:100%;'
				. '">'
				. $html
				. '</div>';
		}

		return '<div class="mwp-sfe-block-preview">' . $html . '</div>';
	}

	// -------------------------------------------------------------------------
	// Stylesheet loading
	// -------------------------------------------------------------------------

	/**
	 * Return the CSS to inject into admin pages.
	 *
	 * Combines:
	 *   1. Block library base styles (style.min.css) - list padding, heading
	 *      margins, table styles, etc.
	 *   2. WP global stylesheet (wp_get_global_stylesheet) - the same
	 *      global-styles-inline-css WP outputs on the frontend, containing
	 *      theme.json CSS variables, color/font presets, and spacing scales.
	 *
	 * Result is cached in a transient and invalidated on theme switch or upgrade.
	 */
	private static function get_block_styles(): string {
		$cached = get_transient( self::CACHE_KEY );
		if ( is_string( $cached ) && $cached !== '' ) {
			return $cached;
		}

		$css = '';

		// Block library base styles
		foreach ( [
			ABSPATH . WPINC . '/css/dist/block-library/style.min.css',
			ABSPATH . WPINC . '/css/dist/block-library/style.css',
		] as $path ) {
			if ( file_exists( $path ) ) {
				$css .= file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions
				break;
			}
		}

		// WP global stylesheet - theme.json variables, presets, and spacing
		if ( function_exists( 'wp_get_global_stylesheet' ) ) {
			$css .= wp_get_global_stylesheet();
		}

		set_transient( self::CACHE_KEY, $css, self::CACHE_TTL );

		return $css;
	}

	/**
	 * Parse serialized block markup and render it to HTML.
	 * Shared by rest_element_history and, via filter, by pro catalog.
	 *
	 * @param string $stored Serialized WP block markup.
	 * @return string Rendered HTML, or empty string on failure.
	 */
	public static function render_stored_block( string $stored ): string {
		if ( empty( trim( $stored ) ) ) {
            return '';
        }

		$blocks = parse_blocks( $stored );
        foreach ( $blocks as $block ) {
			if ( empty( $block['blockName'] ) ) {
                continue;
            }

			$html = render_block( $block );

			/**
			 * Filters stored-block markup for Pro-owned draft-preview augmentation.
			 *
			 * @param string               $html  Rendered block markup.
			 * @param array<string,mixed>  $block Parsed WordPress block.
			 * @param string               $stored Original serialized block markup.
			 */
			return (string) apply_filters( 'mwpsfe_render_stored_block_html', $html, $block, $stored );
		}
		return '';
	}

    /**
     * Generates admin-wrapped HTML for the Content Catalog.
     */
    public static function add_admin_render_data( array $entry, string $permalink, string $uuid ): array {
        $render_map = [
            'before_raw'         => 'before_admin_html',
            'after_raw'          => 'after_admin_html',
            'original_after_raw' => 'original_after_admin_html',
        ];

        foreach ( $render_map as $raw_key => $html_key ) {
            if ( ! empty( $entry[ $raw_key ] ) ) {
                $entry[ $html_key ] = self::strip_style_tags(
                	self::render( $entry[ $raw_key ], false, $permalink, $uuid )
                );
            }
        }

        return $entry;
    }

    /**
     * Prepares the entry array with HTML previews for the DraftManager.
     */
    public static function add_frontend_render_data( array $entry, int $post_id ): array {
        if ( ! empty( $entry['before_raw'] ) ) {
            $entry['before_html'] = self::render_stored_block( $entry['before_raw'] );
        }

        if ( ! empty( $entry['after_raw'] ) ) {
            \MWPSFE\MWPSFE_UUID_Manager::$current_rest_post_id = $post_id;
            $entry['after_html'] = self::render_stored_block( $entry['after_raw'] );
            \MWPSFE\MWPSFE_UUID_Manager::$current_rest_post_id = null;
        }

        return $entry;
    }
}
