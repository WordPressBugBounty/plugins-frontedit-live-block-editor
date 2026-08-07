<?php
/**
 * Content Requests - Free Base
 *
 * Handles the free email-only content-request workflow.
 *
 * Free version sends a simple per-request email to the admin.
 * No ticket-management UI or scheduling - those live in
 * the pro class-mwpsfepro-content-requests.php.
 */

namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_Content_Requests {

	private static $instance;
	private $manager;

	public static function instance() {
		if ( ! self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		$this->manager = MWPSFE_Manager::instance();
	}

	/**
	 * Initialize free hooks.
	 * Pro will add its own hooks on top via MWPSFEPRO_Content_Requests::init().
	 */
	public function init() {
		// Save the free email-settings form (to / from only)
		add_action( 'admin_init', array( $this, 'save_free_email_settings' ) );
	}

	/**
	 * Save the free email settings form submitted from the Settings page.
	 * Pro overrides notification behavior but still relies on these two
	 * options for the recipient and sender addresses.
	 */
	public function save_free_email_settings() {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- This only checks whether the email settings form was submitted; the nonce is verified immediately below before processing.
		if ( ! isset( $_POST['mwpsfe_save_free_request_email'] ) ) {
			return;
		}

		if ( ! MWPSFE_Admin::verify_settings_form_nonce_or_redirect(
			'mwpsfe_free_request_email_action',
			admin_url( 'admin.php?page=' . MWPSFE_SETTINGS_SLUG . '&tab=email' ),
			'The settings page expired before the email settings were submitted. Please review the current values and try again.'
		) ) {
			return;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce is verified above before processing this submitted settings value.
		$email_address = sanitize_email( wp_unslash( $_POST['mwpsfe_request_email_address'] ?? '' ) );

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce is verified above before processing this submitted settings value.
		$from_email = sanitize_email( wp_unslash( $_POST['mwpsfe_request_from_email'] ?? '' ) );

		update_option( 'mwpsfe_request_email_address', $email_address, false );
		update_option( 'mwpsfe_request_from_email', $from_email, false );

		MWPSFE_Admin::set_settings_notice( 'Email settings saved.' );

		wp_safe_redirect( admin_url( 'admin.php?page=' . MWPSFE_SETTINGS_SLUG . '&tab=email' ) );
		exit;
	}

	/**
	 * Create a new content request.
	 *
	 * The free plugin builds the email payload and sends one notification. Pro
	 * listens to the action below to persist ticket data in its own workflow.
	 *
	 * @param int    $post_id             The post ID
	 * @param string $element_uuid        Block UUID being commented on
	 * @param string $handler_id          Handler that created the request
	 * @param string $comment             User's comment / suggestion
	 * @param string $element_text        Current text of the element (for context / fallback display)
	 * @param string $element_type        Human-readable element type label
	 * @param string $element_serialized  Full serialized WP block markup (for accurate preview)
	 * @return array|false The new request array or false on failure
	 */
	public function create_request( $post_id, $element_uuid, $handler_id, $comment, $element_text, $element_type, $element_serialized = '' ) {
		$user = wp_get_current_user();

		$request = array(
			'id'                 => uniqid( 'request_', true ),
			'timestamp'          => current_time( 'timestamp', true ),
			'user_id'            => get_current_user_id(),
			'user_name'          => $user->display_name ? $user->display_name : 'Unknown',
			'user_email'         => $user->user_email,
			'element_uuid'       => $element_uuid,
			'handler_id'         => $handler_id,
			'comment'            => $comment,
			'element_text'       => $element_text,
			'element_type'       => $element_type,
			'element_serialized' => $element_serialized,
			'status'             => 'open',
			'closed_timestamp'   => null,
			'closed_by_id'       => null,
			'closed_by_name'     => null,
			'closure_status'     => null,
			'closure_notes'      => null,
		);

		/**
		 * Fires immediately after a content request is created.
		 *
		 * Pro hooks into this to persist ticket data and manage its own
		 * notification workflow. Base does not create or update ticket storage.
		 *
		 * @param array $request  The new request array.
		 * @param int   $post_id  The post ID.
		 */
		do_action( 'mwpsfe_content_request_created', $request, $post_id );

		/**
		 * Controls whether the free simple-email notification should fire.
		 *
		 * Pro sets this to false so it can handle notifications itself.
		 *
		 * @param bool  $send     True = send the free email.
		 * @param array $request  The request data.
		 * @param int   $post_id  The post ID.
		 */
		if ( apply_filters( 'mwpsfe_free_send_request_email', true, $request, $post_id ) ) {
			$this->send_immediate_admin_notification( $request, $post_id );
		}

		return $request;
	}

	/**
	 * Send a single notification email to the admin for a new request.
	 *
	 * @param array  $request Request payload.
	 * @param int    $post_id Target post ID.
	 * @param string $footer  Optional replacement footer HTML.
	 * @return void
	 */
	public function send_immediate_admin_notification( $request, $post_id, $footer = '' ) {
		$post    = get_post( $post_id );
		$subject = '[' . get_bloginfo( 'name' ) . '] New Content Request';

		if ( '' === $footer ) {
			$view_on_page = get_permalink( $post_id ) . '#' . $request['element_uuid'];
			$footer       = '<a href="' . esc_url( $view_on_page ) . '" style="' . MWPSFE_Admin::EMAIL_S_FOOTER_LINK . '">View on page</a>';
		}

		$message = apply_filters( 'mwpsfe_email_template', '', array(
			'title'   => 'New Content Request',
			'content' => $this->render_request_email_content( $request, $post ),
			'footer'  => $footer,
		) );

		wp_mail(
			apply_filters( 'mwpsfe_notification_admin_email', '' ),
			$subject,
			$message,
			array(
				'Content-Type: text/html; charset=UTF-8',
				'From: ' . apply_filters( 'mwpsfe_notification_from_email', '' ),
			)
		);
	}

	/**
	 * Render the HTML block for a single content request inside an email.
	 */
	public function render_request_email_content( $request, $post ) {
		$page_url = get_permalink( $post->ID );
		$uuid     = $request['element_uuid'];

		$html  = '<div style="' . MWPSFE_Admin::EMAIL_S_CARD . '">';
		$html .= '<h3 style="' . MWPSFE_Admin::EMAIL_S_H3_TITLE . '">'
			. '<a href="' . esc_url( $page_url . '#' . $uuid ) . '" style="' . MWPSFE_Admin::EMAIL_S_LINK . '">'
			. esc_html( $post->post_title )
			. '</a></h3>';

		$html .= '<div style="' . MWPSFE_Admin::EMAIL_S_META . '">';
		$html .= '<strong>From:</strong> '    . esc_html( $request['user_name'] )                 . '<br>';
		$html .= '<strong>Date:</strong> '    . esc_html( MWPSFE_Date_Utils::format_timestamp( $request['timestamp'] ) ) . '<br>';
		$html .= '<strong>Element:</strong> ' . esc_html( $request['element_type'] );
		$html .= '</div>';

		// Element preview.
		$html .= '<div style="margin-top:15px;">';
		$html .= '<div style="' . MWPSFE_Admin::EMAIL_S_LABEL . '">Element Preview</div>';
		if ( ! empty( $request['element_serialized'] ) ) {
			$preview = MWPSFE_Block_Renderer::render( $request['element_serialized'], true, $page_url, $uuid );
			$html   .= '<div style="' . MWPSFE_Admin::EMAIL_S_PREVIEW . '">' . $preview . '</div>';
		} else {
			$html .= '<div style="font-size:13px;color:#1d2327;">' . esc_html( wp_trim_words( $request['element_text'], 20 ) ) . '</div>';
		}
		$html .= '</div>';

		// Request comment.
		$html .= '<div style="margin-top:15px;">';
		$html .= '<div style="' . MWPSFE_Admin::EMAIL_S_LABEL . '">Request</div>';
		$html .= '<div style="' . MWPSFE_Admin::EMAIL_S_PREVIEW . 'font-size:13px;color:#1d2327;">' . nl2br( esc_html( $request['comment'] ) ) . '</div>';
		$html .= '</div>';

		$html .= '</div>';
		return $html;
	}
}
