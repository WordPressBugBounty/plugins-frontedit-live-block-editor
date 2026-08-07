<?php
namespace MWPSFE;

use WP_Post;

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Define the WordPress post-content model that FrontEdit can safely manage.
 *
 * FrontEdit deliberately supports Gutenberg content stored in post_content,
 * not arbitrary post-meta fields or third-party field storage. Keeping this
 * policy in one place prevents asset loading, UUID preparation, REST access,
 * and Pro catalog behavior from drifting apart as post types are added.
 */
final class MWPSFE_Post_Content_Support {

	/**
	 * Determine whether a registered post type has a FrontEdit-compatible
	 * Gutenberg post_content model.
	 *
	 * @param string $post_type Registered post type name.
	 * @return bool Whether the post type exposes a public Gutenberg post_content model.
	 */
	public static function is_supported_post_type( string $post_type ): bool {
		// Posts and pages are FrontEdit's established, stable content model.
		// Keep that baseline independent of any third-party modification to the
		// registered post-type object while applying explicit requirements to CPTs.
		if ( in_array( $post_type, array( 'post', 'page' ), true ) ) {
			return true;
		}

		$post_type_object = get_post_type_object( $post_type );

		if ( ! $post_type_object ) {
			return false;
		}

		return ! empty( $post_type_object->publicly_queryable )
			&& post_type_supports( $post_type, 'editor' )
			&& ! empty( $post_type_object->show_in_rest );
	}

	/**
	 * Determine whether a specific post is eligible for FrontEdit.
	 *
	 * This deliberately checks the post's storage model rather than the editor
	 * selected for the current request. FrontEdit operates on serialized block
	 * content on both frontend and backend requests, so an editor-specific
	 * filter must not make the same post eligible in one request and invisible
	 * in another.
	 *
	 * @param mixed $post Post object or value to evaluate.
	 * @return bool Whether FrontEdit may manage this post's block content.
	 */
	public static function is_supported_post( $post ): bool {
		if ( ! $post instanceof WP_Post || ! self::is_supported_post_type( $post->post_type ) ) {
			return false;
		}

		return true;
	}

	/**
	 * Determine whether a post ID resolves to a FrontEdit-compatible post.
	 *
	 * @param int $post_id Post ID.
	 * @return bool Whether the post is eligible for FrontEdit.
	 */
	public static function is_supported_post_id( int $post_id ): bool {
		return self::is_supported_post( get_post( $post_id ) );
	}

	/**
	 * Return all currently registered FrontEdit-compatible post types.
	 *
	 * @return string[] Registered post type names.
	 */
	public static function get_supported_post_types(): array {
		$post_types = get_post_types( array(), 'names' );

		return array_values(
			array_filter(
				$post_types,
				static function( string $post_type ): bool {
					return self::is_supported_post_type( $post_type );
				}
			)
		);
	}
}
