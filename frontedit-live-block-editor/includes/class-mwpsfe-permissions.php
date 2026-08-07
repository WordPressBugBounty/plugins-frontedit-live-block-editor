<?php
namespace MWPSFE;

use WP_Post;
use WP_Query;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_Permissions {

	private static $instance;

	/**
	 * Get singleton instance of the Permissions
	 * 
	 * This ensures only one instance of the Permissions exists throughout the WordPress lifecycle.
	 * The instance is initialized on first call and cached for subsequent calls.
	 * 
	 * @return MWPSFE_Permissions The singleton instance
	 */
	public static function instance() {
		if ( ! self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Initialize the Permissions system
	 * Placeholder for future hook registrations (e.g. filtering permissions).
	 * Called automatically by instance() method.
	 * * @return void
	 */
	public function init() {}

	/**
	 * Get effective permissions for a specific user on a specific post
	 * 
	 * This method determines what actions a user can perform (publish, draft, comment)
	 * by combining:
	 * 1. Plugin-level permissions (from settings)
	 * 2. WordPress native capabilities (edit_post, publish_posts)
	 * 
	 * Baseline access is deliberately role- and post-scoped before any Pro
	 * override is considered:
	 * - Administrators and Editors may work on eligible posts they can edit.
	 * - Authors may work only on their own posts.
	 * - Contributors may comment only on their own pending posts in free mode.
	 * - All other roles, including Subscribers, have no frontend access.
	 *
	 * Extensions may filter the resulting permissions, but the base policy never
	 * grants access to an otherwise ineligible role or post.
	 * 
	 * @param int $user_id The user ID to check permissions for
	 * @param int $post_id The post ID to check permissions against
	 * @return array Associative array with 'can_publish', 'can_draft', 'can_comment', and 'can_batch' booleans
	 */
	public function get_user_effective_permissions( $user_id, $post_id ) {
		$user = get_userdata( $user_id );
		$post = get_post( $post_id );
		if ( ! $user || ! MWPSFE_Post_Content_Support::is_supported_post( $post ) ) {
			return $this->no_access_permissions();
		}

		$baseline = $this->get_baseline_permissions( $user, $post );
		if ( ! $baseline['eligible'] ) {
			return $this->no_access_permissions();
		}

		$permissions = array(
			'can_publish' => $baseline['can_publish'],
			'can_draft'   => false,
			'can_comment' => $baseline['can_comment'],
			'can_batch'   => $baseline['can_publish'],
		);

		/**
		 * Filter FrontEdit permissions after the free role policy is applied.
		 *
		 * Add-ons may narrow these permissions or enable separately packaged
		 * workflows, but must preserve the baseline eligibility constraints.
		 *
		 * @param array $permissions Base publish/draft/comment/batch permission map.
		 * @param int   $user_id     User being evaluated.
		 * @param int   $post_id     Target post.
		 * @param array $baseline    Immutable role and post eligibility map.
		 */
		return apply_filters( 'mwpsfe_effective_permissions', $permissions, $user_id, $post_id, $baseline );
	}

	/**
	 * Return the fixed no-access permission map.
	 *
	 * @return array{can_publish:bool,can_draft:bool,can_comment:bool,can_batch:bool}
	 */
	private function no_access_permissions(): array {
		return array(
			'can_publish' => false,
			'can_draft'   => false,
			'can_comment' => false,
			'can_batch'   => false,
		);
	}

	/**
	 * Determine the role and post scope that FrontEdit may ever expose.
	 *
	 * This baseline is intentionally stricter than generic WordPress login or
	 * read access. It prevents Subscribers and unrelated users from receiving
	 * frontend assets, UUID maps, handlers, or REST access for another user's
	 * content.
	 *
	 * @param \WP_User $user Current user.
	 * @param \WP_Post $post Requested post.
	 * @return array{eligible:bool,can_edit:bool,can_publish:bool,can_comment:bool}
	 */
	private function get_baseline_permissions( \WP_User $user, \WP_Post $post ): array {
		$user_id         = (int) $user->ID;
		$post_id         = (int) $post->ID;
		$roles           = (array) $user->roles;
		$native_can_edit = user_can( $user_id, 'edit_post', $post_id );
		$is_owner        = $user_id === (int) $post->post_author;
		$can_publish     = $this->user_can_publish_post_type( $user_id, $post );

		if ( is_super_admin( $user_id ) || array_intersect( array( 'administrator', 'editor' ), $roles ) ) {
			return array(
				'eligible'    => $native_can_edit,
				'can_edit'    => $native_can_edit,
				'can_publish' => $native_can_edit && $can_publish,
				'can_comment' => $native_can_edit,
			);
		}

		if ( in_array( 'author', $roles, true ) ) {
			return array(
				'eligible'    => $is_owner && $native_can_edit,
				'can_edit'    => $is_owner && $native_can_edit,
				'can_publish' => $is_owner && $native_can_edit && $can_publish,
				'can_comment' => $is_owner && $native_can_edit,
			);
		}

		if ( in_array( 'contributor', $roles, true ) ) {
			$can_comment = $is_owner && 'pending' === $post->post_status && $native_can_edit;

			return array(
				'eligible'    => $can_comment,
				'can_edit'    => $can_comment,
				'can_publish' => false,
				'can_comment' => $can_comment,
			);
		}

		return array(
			'eligible'    => false,
			'can_edit'    => false,
			'can_publish' => false,
			'can_comment' => false,
		);
	}

	/**
	 * Determine whether a user has the native publish capability for this post's
	 * type, rather than assuming that every editable item is a standard post.
	 *
	 * @param int      $user_id User ID.
	 * @param \WP_Post $post    Requested post.
	 * @return bool Whether the user may publish this post type.
	 */
	private function user_can_publish_post_type( int $user_id, \WP_Post $post ): bool {
		$post_type = get_post_type_object( $post->post_type );
		$capability = $post_type && isset( $post_type->cap->publish_posts )
			? $post_type->cap->publish_posts
			: 'publish_posts';

		return user_can( $user_id, $capability );
	}

	/**
	 * Check whether the REST request targets an existing post the current user
	 * may edit through FrontEdit.
	 *
	 * Raw block content, rendered block HTML, history, and edit previews must
	 * never be available solely because a user may submit a content request.
	 *
	 * @param \WP_REST_Request $request REST request containing post_id.
	 * @return bool Whether the user has publish or draft access for the post.
	 */
	public function check_rest_edit_permission( $request ): bool {
		$post_id = (int) $request->get_param( 'post_id' );
		$user_id = get_current_user_id();

		if ( ! $user_id || ! $post_id || ! get_post( $post_id ) ) {
			return false;
		}

		$perms = $this->get_user_effective_permissions( $user_id, $post_id );

		return ! empty( $perms['can_publish'] ) || ! empty( $perms['can_draft'] );
	}

	/**
	 * Check whether the current user may publish one frontend block edit.
	 *
	 * This is kept separate from the broader edit check because the single-edit
	 * save route writes directly to published post content.
	 *
	 * @param \WP_REST_Request $request REST request containing post_id.
	 * @return bool Whether the user may publish the requested post.
	 */
	public function check_rest_publish_permission( $request ): bool {
		$post_id = (int) $request->get_param( 'post_id' );
		$user_id = get_current_user_id();

		if ( ! $user_id || ! $post_id || ! get_post( $post_id ) ) {
			return false;
		}

		$perms = $this->get_user_effective_permissions( $user_id, $post_id );

		return ! empty( $perms['can_publish'] );
	}

	/**
	 * Check whether the current user may load the full block tree for a batch
	 * editing session.
	 *
	 * Draft-capable Pro users may load this state so they can submit a batch for
	 * review; the separate batch-save permission controls whether the request may
	 * write directly to published content.
	 *
	 * @param \WP_REST_Request $request REST request containing post_id.
	 * @return bool Whether the user may use batch editing for the requested post.
	 */
	public function check_rest_batch_tree_permission( $request ): bool {
		$post_id = (int) $request->get_param( 'post_id' );
		$user_id = get_current_user_id();

		if ( ! $user_id || ! $post_id || ! get_post( $post_id ) ) {
			return false;
		}

		$perms = $this->get_user_effective_permissions( $user_id, $post_id );

		return ! empty( $perms['can_batch'] );
	}

	/**
	 * Check whether the current user may apply a published batch edit.
	 *
	 * Batch editing and publish access are intentionally checked together. This
	 * prevents a user who may stage a Pro draft batch from using the Base live
	 * batch route to publish it directly.
	 *
	 * @param \WP_REST_Request $request REST request containing post_id.
	 * @return bool Whether the user may publish a batch to the requested post.
	 */
	public function check_rest_batch_apply_permission( $request ): bool {
		$post_id = (int) $request->get_param( 'post_id' );
		$user_id = get_current_user_id();

		if ( ! $user_id || ! $post_id || ! get_post( $post_id ) ) {
			return false;
		}

		$perms = $this->get_user_effective_permissions( $user_id, $post_id );

		return ! empty( $perms['can_batch'] ) && ! empty( $perms['can_publish'] );
	}

	/**
	 * Check whether the current user may browse or resolve media for an edit.
	 *
	 * FrontEdit edit access scopes the request to its target post while the
	 * native upload_files capability prevents comment-only users from browsing
	 * the site's attachment library.
	 *
	 * @param \WP_REST_Request $request REST request containing post_id.
	 * @return bool Whether the user may use the media editing routes.
	 */
	public function check_rest_media_permission( $request ): bool {
		return current_user_can( 'upload_files' ) && $this->check_rest_edit_permission( $request );
	}

	/**
	 * Check whether the current user may resolve one specific attachment for an edit.
	 *
	 * Resolving an attachment returns its URL and metadata, so the generic media
	 * route checks are not sufficient on their own. The caller must be able to
	 * read the specific attachment, but does not need to edit its media record:
	 * FrontEdit mirrors Gutenberg by allowing users who may edit the target post
	 * to use readable site media in that post.
	 *
	 * @param \WP_REST_Request $request REST request containing post_id and attachment_id.
	 * @return bool Whether the user may resolve the requested attachment.
	 */
	public function check_rest_resolve_media_permission( $request ): bool {
		$attachment_id = (int) $request->get_param( 'attachment_id' );
		$attachment    = get_post( $attachment_id );

		return $attachment instanceof \WP_Post
			&& 'attachment' === $attachment->post_type
			&& $this->check_rest_media_permission( $request )
			&& current_user_can( 'read_post', $attachment_id );
	}

	/**
	 * Check whether the current user may submit a content request for a post.
	 *
	 * Comment access remains intentionally more permissive than editing, but it
	 * must still be limited to an existing post the user is allowed to read.
	 *
	 * @param \WP_REST_Request $request REST request containing post_id.
	 * @return bool Whether the user may submit a content request.
	 */
	public function check_rest_comment_permission( $request ): bool {
		$post_id = (int) $request->get_param( 'post_id' );
		$user_id = get_current_user_id();

		if ( ! $user_id || ! $post_id || ! get_post( $post_id ) ) {
			return false;
		}

		$perms = $this->get_user_effective_permissions( $user_id, $post_id );

		return ! empty( $perms['can_comment'] );
	}
}
