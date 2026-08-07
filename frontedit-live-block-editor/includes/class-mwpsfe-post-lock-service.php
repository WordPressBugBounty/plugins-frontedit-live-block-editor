<?php
namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * Coordinates FrontEdit sessions with WordPress's native post-lock lease.
 *
 * The core post-lock helpers are intentionally used instead of a plugin-owned
 * meta key so Gutenberg, the classic editor, and FrontEdit all honour one
 * active editor for a post.
 */
class MWPSFE_Post_Lock_Service {

	/** @var MWPSFE_Post_Lock_Service|null */
	private static $instance = null;

	/**
	 * Get the shared post-lock service.
	 *
	 * @return MWPSFE_Post_Lock_Service
	 */
	public static function instance(): MWPSFE_Post_Lock_Service {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	/**
	 * Load the WordPress admin post helpers when FrontEdit runs on the frontend.
	 *
	 * @return void
	 */
	private function load_core_helpers(): void {
		if ( ! function_exists( 'wp_check_post_lock' ) || ! function_exists( 'wp_set_post_lock' ) ) {
			require_once ABSPATH . 'wp-admin/includes/post.php';
		}
	}

	/**
	 * Build the safe owner data returned to the authorized frontend client.
	 *
	 * @param int $user_id User ID owning the active lock.
	 * @return array<string,mixed>
	 */
	private function owner_payload( int $user_id ): array {
		$user = get_userdata( $user_id );

		return array(
			'id'         => $user_id,
			'name'       => $user ? $user->display_name : __( 'Another user', 'frontedit-live-block-editor' ),
			'avatar_url' => $user ? get_avatar_url( $user_id, array( 'size' => 64 ) ) : '',
		);
	}

	/**
	 * Return the active lock held by someone other than the current user.
	 *
	 * @param int $post_id Target post ID.
	 * @return array<string,mixed>|null Lock payload, or null when available.
	 */
	public function get_other_user_lock( int $post_id ): ?array {
		$this->load_core_helpers();
		$owner_id = wp_check_post_lock( $post_id );

		if ( ! $owner_id ) {
			return null;
		}

		return array( 'owner' => $this->owner_payload( (int) $owner_id ) );
	}

	/**
	 * Claim or refresh the current user's native WordPress post lock.
	 *
	 * @param int  $post_id     Target post ID.
	 * @param bool $take_over   Whether the user explicitly chose to take over.
	 * @return array<string,mixed>
	 */
	public function claim_lock( int $post_id, bool $take_over = false ): array {
		$post = get_post( $post_id );
		if ( ! $post ) {
			return array( 'error' => 'Post not found', 'status' => 404 );
		}

		$this->load_core_helpers();
		$lock = $this->get_other_user_lock( $post_id );

		if ( $lock && ! $take_over ) {
			return array( 'error' => 'POST_LOCKED', 'lock' => $lock, 'status' => 200 );
		}

		if ( $lock && $take_over ) {
			$owner = get_userdata( (int) $lock['owner']['id'] );
			// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- This is an existing WordPress core filter.
			if ( ! $owner || ! apply_filters( 'override_post_lock', true, $post, $owner ) ) {
				return array( 'error' => 'POST_LOCKED', 'lock' => $lock, 'status' => 200 );
			}
		}

		wp_set_post_lock( $post );
		return array( 'success' => true );
	}

	/**
	 * Expire the current user's native post lock after a one-off admin action.
	 *
	 * This mirrors WordPress's own lock-release behavior: it conditionally
	 * replaces the exact active lock with an expired timestamp instead of
	 * deleting post meta. The compare-and-swap update preserves a newer lock if
	 * another user took ownership after the action completed.
	 *
	 * @param int $post_id Target post ID.
	 * @return bool Whether this request released its own lock.
	 */
	public function release_current_user_lock( int $post_id ): bool {
		$post = get_post( $post_id );
		if ( ! $post ) {
			return false;
		}

		$current_user_id = get_current_user_id();
		$active_lock     = (string) get_post_meta( $post_id, '_edit_lock', true );
		$lock_parts      = explode( ':', $active_lock );
		$lock_owner_id   = isset( $lock_parts[1] ) ? (int) $lock_parts[1] : 0;

		if ( ! $current_user_id || $lock_owner_id !== $current_user_id ) {
			return false;
		}

		// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- This is an existing WordPress core filter.
		$expired_lock = ( time() - (int) apply_filters( 'wp_check_post_lock_window', 150 ) + 5 ) . ':' . $current_user_id;

		return (bool) update_post_meta( $post_id, '_edit_lock', $expired_lock, $active_lock );
	}

	/**
	 * Reject a post-content write when another user owns the native lock.
	 *
	 * @param int $post_id Target post ID.
	 * @return array<string,mixed>|null Error payload or null when writable.
	 */
	public function guard_write( int $post_id ): ?array {
		$lock = $this->get_other_user_lock( $post_id );
		if ( ! $lock ) {
			return null;
		}

		return array( 'error' => 'POST_LOCKED', 'lock' => $lock, 'status' => 200 );
	}
}
