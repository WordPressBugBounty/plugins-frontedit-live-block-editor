<?php
/**
 * Admin Settings and UI
 *
 * @package MWPSFE_Admin
 */

namespace MWPSFE;

use DateTime;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_Admin {

	private static $instance;
	private $uuid_manager;

	// -------------------------------------------------------------------------
	// Email inline-style constants
	// -------------------------------------------------------------------------

	/** Content card container (grey bg, border, shadow). */
	const EMAIL_S_CARD = 'background:#f9f9f9;padding:10px;border-radius:6px;border:1px solid #dcdcde;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,.1);';

	/** Admin class equivalent: .mwp-sfe-media-card-label, .mwp-sfe-request-label */
	const EMAIL_S_LABEL = 'font-size:11px;font-weight:600;text-transform:uppercase;color:#787c82;margin-bottom:6px;';

	/** Admin class equivalent: .mwp-sfe-block-preview */
	const EMAIL_S_PREVIEW = 'background:#fff;padding:10px;border-radius:4px;border:1px solid #dcdcde;margin-top:8px;word-break:break-word;overflow:hidden;overflow-wrap:anywhere;box-shadow:inset 0 2px 8px rgba(0,0,0,.1);';

	/** Metadata row inside a card (From, Date, Element type - 8px bottom margin). */
	const EMAIL_S_META = 'font-size:13px;color:#50575e;margin-bottom:8px;';

	/** Top-of-email metadata block in batch digest emails (16px bottom margin). */
	const EMAIL_S_META_HEADER = 'font-size:13px;color:#50575e;margin-bottom:16px;';

	/** H3 element/page title inside an email card. */
	const EMAIL_S_H3_TITLE = 'font-size:16px;color:#1d2327;margin:0 0 10px;';

	/** Primary link color + no underline (used inside card headings and body links). */
	const EMAIL_S_LINK = 'color:#2271b1;text-decoration:none;';

	/** Footer action link color (standalone "View on page", "View catalog", etc.). */
	const EMAIL_S_FOOTER_LINK = 'color:#2271b1;';

	/** Status badge - everything after "background:XX;" (display, color, padding, etc.). */
	const EMAIL_S_BADGE = 'display:inline-block;color:#fff;padding:4px 10px;border-radius:3px;font-size:12px;font-weight:600;margin-bottom:10px;';

	/** H2 section header in email body ("Currently Open Requests:", etc.). */
	const EMAIL_S_H2_SECTION = 'font-size:18px;color:#1d2327;margin:0 0 20px;';

	public static function instance() {
		if ( ! self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		$this->uuid_manager = MWPSFE_UUID_Manager::instance();
	}

	public function init() {
		add_action( 'admin_init',                        array( $this, 'admin_init' ) );
		add_action( 'admin_menu',                        array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts',             array( $this, 'enqueue_settings_styles' ) );
		add_action( 'mwpsfe_render_settings_email_tab', array( $this, 'render_email_tab_free_card' ), 5 );
		add_filter( 'mwpsfe_notification_admin_email',  array( $this, 'filter_admin_email' ) );
		add_filter( 'mwpsfe_notification_from_email',   array( $this, 'filter_from_email' ) );
		add_filter( 'mwpsfe_email_template',            array( $this, 'filter_email_template' ), 10, 2 );
	}

	public function admin_init() {
	}

	/**
	 * Enqueue shared admin styles only for FrontEdit's registered admin screens.
	 *
	 * Uses WordPress's hook suffix instead of request query parameters. Asset
	 * routing is therefore independent of unverified navigation input while the
	 * base stylesheet remains available to the separately registered Pro screens.
	 *
	 * @param string $hook Current admin page hook suffix.
	 * @return void
	 */
	public function enqueue_settings_styles( string $hook ): void {
		$plugin_hooks = array(
			$this->hook_dashboard,
			$this->hook_settings,
			get_plugin_page_hookname( MWPSFE_REQUESTS_SLUG, MWPSFE_MENU_SLUG ),
			get_plugin_page_hookname( MWPSFE_CATALOG_SLUG, MWPSFE_MENU_SLUG ),
		);

		if ( ! in_array( $hook, $plugin_hooks, true ) ) {
			return;
		}

		wp_enqueue_style(
			'mwpsfe-admin-settings',
			MWPSFE_PLUGIN_URL . 'includes/assets/css/admin-settings.css',
			array(),
			MWPSFE_VERSION
		);

		wp_enqueue_style(
			'mwpsfe-admin-pro-preview',
			MWPSFE_PLUGIN_URL . 'includes/assets/css/admin-pro-preview.css',
			array( 'mwpsfe-admin-settings' ),
			MWPSFE_VERSION
		);

		// Load block/global preview CSS once per admin page so AJAX-loaded history
		// previews never inject unscoped <style> tags into the DOM.
		wp_add_inline_style(
			'mwpsfe-admin-settings',
			MWPSFE_Block_Renderer::get_admin_preview_styles()
		);

		if ( ! mwpsfepro_class_exists() && $hook === $this->hook_settings ) {
			wp_enqueue_script(
				'mwpsfe-admin-license-prompt',
				MWPSFE_PLUGIN_URL . 'includes/assets/js/admin-license-prompt.js',
				array(),
				MWPSFE_VERSION,
				true
			);

			wp_localize_script(
				'mwpsfe-admin-license-prompt',
				'mwpSfeLicensePrompt',
				array(
					'upgradeUrl' => esc_url_raw( MWPSFE_PLUGIN_URI . '?utm_source=mwpsfe_license_tab#choose-your-plan' ),
				)
			);
		}
	}

	public $hook_dashboard = '';
	public $hook_settings  = '';

	/**
	 * Register the FrontEdit administrative navigation.
	 *
	 * Base exposes a practical Getting Started screen and Settings. Pro owns
	 * its separate workflow destinations, so Base does not present inaccessible
	 * previews as menu items.
	 *
	 * @return void
	 */
	public function register_admin_menu() {
		$this->hook_dashboard = add_menu_page(
			MWPSFE_PLUGIN_NAME,
			MWPSFE_PLUGIN_NAME,
			'manage_options',
			MWPSFE_MENU_SLUG,
			array( $this, 'render_dashboard_page' ),
			'dashicons-feedback',
			65
		);

		$primary_label = mwpsfe_is_pro_active() ? 'Dashboard' : 'Getting Started';
		add_submenu_page( MWPSFE_MENU_SLUG, $primary_label, $primary_label, 'manage_options', MWPSFE_MENU_SLUG, array( $this, 'render_dashboard_page' ) );

		$this->hook_settings = add_submenu_page( MWPSFE_MENU_SLUG, 'Settings', 'Settings', 'manage_options', MWPSFE_SETTINGS_SLUG, array( $this, 'render_settings_page' ) );
	}

	/**
	 * Render a consistent Pro upgrade overlay for Base admin teasers.
	 *
	 * @param string $title       Overlay heading.
	 * @param string $description Overlay description.
	 * @param string $source      UTM source for the upgrade link.
	 * @return void
	 */
	private function render_pro_upgrade_overlay( string $title, string $description, string $source ): void {
		$upgrade_url = MWPSFE_PLUGIN_URI . '?utm_source=' . rawurlencode( $source ) . '#choose-your-plan';
		?>
		<div class="mwp-sfe-upgrade-overlay">
			<div class="mwp-sfe-upgrade-overlay-icon">🔒</div>
			<h3 class="mwp-sfe-upgrade-overlay-title"><?php echo esc_html( $title ); ?></h3>
			<p class="mwp-sfe-upgrade-overlay-desc"><?php echo esc_html( $description ); ?></p>
			<a href="<?php echo esc_url( $upgrade_url ); ?>" target="_blank" class="button button-primary">Upgrade to Pro</a>
		</div>
		<?php
	}

	/**
	 * Render the Base preview of Pro's content-request workflow.
	 *
	 * @return void
	 */
	public function render_content_requests_teaser_page(): void {
		?>
		<div class="wrap mwp-sfe-requests-wrap">
			<h1>Content Requests</h1>
			<p>Manage editorial comments and content update requests from users.</p>
			<div class="mwp-sfe-preview-wrap mwp-sfe-preview-wrap-wide">
				<?php $this->render_pro_upgrade_overlay( 'Unlock Content Requests', 'Review active requests, resolve completed work, and keep a searchable request history.', 'mwpsfe_content_requests_page' ); ?>
				<div class="mwp-sfe-preview-blur" aria-hidden="true">
					<div id="mwp-sfe-requests-container">
						<h2 style="margin-top:20px;">Pages</h2>
						<div class="mwp-sfe-request-post-card expanded">
							<div class="mwp-sfe-request-post-header">
								<div>
									<h3 class="mwp-sfe-request-post-title">About Us</h3>
									<h4 class="mwp-sfe-request-post-id">(ID: 42)</h4>
								</div>
								<span class="mwp-sfe-request-count is-pending">1 open</span>
							</div>
							<div class="mwp-sfe-requests-list">
								<div class="mwp-sfe-request-item" data-post-id="42" data-request-id="preview-about-copy">
									<div class="mwp-sfe-request-header">
										<div class="mwp-sfe-request-preview">
											<span class="mwp-sfe-request-warning">⚠</span>
											<span class="mwp-sfe-request-element-type">Paragraph</span>
										</div>
									</div>
									<div class="mwp-sfe-request-details">
										<div class="mwp-sfe-request-meta">
											<strong>User:</strong> Thomas Anderson<br>
											<strong>Date:</strong> July 21, 2026 2:15 pm
										</div>
										<div class="mwp-sfe-request-element-preview">
											<div class="mwp-sfe-request-label">Element Preview</div>
											<div class="mwp-sfe-block-preview">
												<p>Our team combines practical experience with a clear focus on long-term client success.</p>
											</div>
										</div>
										<div class="mwp-sfe-request-comment">
											<div class="mwp-sfe-request-label">Request</div>
											<div class="mwp-sfe-request-comment-text">Could we mention that we also work with small businesses? That is the question I keep getting from new clients.</div>
										</div>
										<div class="mwp-sfe-request-actions">
											<a class="button button-small mwp-sfe-view-link">View on page</a>
											<button class="button button-small mwp-sfe-close-request-btn">Close request</button>
										</div>
									</div>
								</div>
							</div>
						</div>
						<h2 style="margin-top:40px;">Posts</h2>
						<div class="mwp-sfe-request-post-card">
							<div class="mwp-sfe-request-post-header">
								<div>
									<h3 class="mwp-sfe-request-post-title">Preparing for Your First Consultation</h3>
									<h4 class="mwp-sfe-request-post-id">(ID: 87)</h4>
								</div>
								<span class="mwp-sfe-request-count is-pending">2 open</span>
							</div>
						</div>
					</div>
					<div style="margin-top:60px;padding-top:30px;border-top:2px solid #c3c4c7;">
						<h2>Request History</h2>
						<p class="description">View all closed and resolved content requests.</p>
						<div id="mwp-sfe-history-container" style="margin-top:20px;">
							<h3 style="margin-top:40px;">Posts</h3>
							<div class="mwp-sfe-history-post-card expanded">
								<div class="mwp-sfe-history-post-header">
									<div>
										<h4 class="mwp-sfe-history-post-title">Client Success Stories</h4>
										<h5 class="mwp-sfe-history-post-id">(ID: 91)</h5>
									</div>
									<span class="mwp-sfe-history-count">2 closed</span>
								</div>
								<div class="mwp-sfe-history-requests-list" data-post-id="91">
									<div class="mwp-sfe-history-item">
										<div class="mwp-sfe-request-header">
											<div class="mwp-sfe-request-preview">
												<span class="mwp-sfe-request-element-type">Paragraph</span>
											</div>
										</div>
										<div class="mwp-sfe-request-details">
											<div class="mwp-sfe-request-meta">
												<strong>User:</strong> Patrick Bateman<br>
												<strong>Date:</strong> July 18, 2026 9:30 am<br>
												<strong>Status:</strong> <span class="mwp-sfe-history-status status-complete">Complete</span>
											</div>
											<div class="mwp-sfe-request-element-preview">
												<div class="mwp-sfe-request-label">Element Preview</div>
												<div class="mwp-sfe-block-preview">
													<p>We help teams turn complicated projects into straightforward results.</p>
												</div>
											</div>
											<div class="mwp-sfe-request-comment">
												<div class="mwp-sfe-request-label">Request</div>
												<div class="mwp-sfe-request-comment-text">The new case study is live. Can we update this sentence so it reflects that work?</div>
											</div>
											<div class="mwp-sfe-history-closure">
												<strong>Closed by:</strong> Keyser Söze on July 19, 2026 11:05 am<br>
												<strong>Notes:</strong> Updated to reference the new case study.
											</div>
										</div>
									</div>
									<div class="mwp-sfe-history-item">
										<div class="mwp-sfe-request-header">
											<div class="mwp-sfe-request-preview">
												<span class="mwp-sfe-request-element-type">Heading</span>
											</div>
										</div>
										<div class="mwp-sfe-request-details">
											<div class="mwp-sfe-request-meta">
												<strong>User:</strong> Tyler Durden<br>
												<strong>Date:</strong> July 15, 2026 4:45 pm<br>
												<strong>Status:</strong> <span class="mwp-sfe-history-status status-ignored">Ignored</span>
											</div>
											<div class="mwp-sfe-request-element-preview">
												<div class="mwp-sfe-request-label">Element Preview</div>
												<div class="mwp-sfe-block-preview">
													<h2>Results That Matter</h2>
												</div>
											</div>
											<div class="mwp-sfe-request-comment">
												<div class="mwp-sfe-request-label">Request</div>
												<div class="mwp-sfe-request-comment-text">Could we make this title more dramatic?</div>
											</div>
											<div class="mwp-sfe-history-closure">
												<strong>Closed by:</strong> Thomas Anderson on July 16, 2026 8:20 am<br>
												<strong>Notes:</strong> Kept the current heading to match the rest of the page.
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
		<?php
	}

	/**
	 * Render the Base preview of Pro's catalog and version-history workflow.
	 *
	 * @return void
	 */
	public function render_content_catalog_teaser_page(): void {
		?>
		<div class="wrap mwp-sfe-catalog-wrap">
			<h1>Content Catalog</h1>
			<p>Track all editable elements across your site with complete version history.</p>
			<div class="mwp-sfe-preview-wrap mwp-sfe-preview-wrap-wide">
				<?php $this->render_pro_upgrade_overlay( 'Unlock the Content Catalog', 'Browse editable content, review pending drafts, and view complete version history across your site.', 'mwpsfe_content_catalog_page' ); ?>
				<div class="mwp-sfe-preview-blur" aria-hidden="true">
					<div id="mwp-sfe-catalog-container">
						<h2 style="margin-top:20px;">Pages</h2>
						<div class="mwp-sfe-post-card expanded">
							<div class="mwp-sfe-post-header">
								<div>
									<h3 class="mwp-sfe-post-title">Services</h3>
									<h4 class="mwp-sfe-post-id">(ID: 42)</h4>
									<div class="mwp-sfe-post-meta">Last modified: July 21, 2026</div>
								</div>
								<span class="mwp-sfe-element-count is-pending">1 pending</span>
							</div>
							<div class="mwp-sfe-elements-list">
								<div class="mwp-sfe-element-type-section expanded">
									<h4 class="mwp-sfe-element-type-header">
										<span class="pending-icon">⚠</span>
										<span>Paragraph (2)</span>
									</h4>
									<ul class="mwp-sfe-element-type-list">
										<li class="mwp-sfe-element-item show-history">
											<div class="mwp-sfe-element-header">
												<div class="mwp-sfe-element-preview">
													<span>Our team combines practical experience with a clear focus on long-term client success.</span>
												</div>
												<div class="mwp-sfe-element-stats">
													<span class="status-warning">⚠ Review Pending Draft</span>
												</div>
											</div>
											<div class="mwp-sfe-history-container">
												<div class="mwp-sfe-history-timeline">
													<div class="mwp-sfe-history-entry status-pending">
														<div class="mwp-sfe-history-meta">
															<span class="mwp-sfe-history-version">
																Version 3<small> (Pending Review)</small>
															</span>
															<span class="mwp-sfe-history-date">July 21, 2026 2:15 pm</span>
														</div>
														<div class="mwp-sfe-history-user">By: Thomas Anderson</div>
														<div class="mwp-sfe-history-content">
															<div class="mwp-sfe-history-before">
																<div class="mwp-sfe-history-label">Original</div>
																<div class="mwp-sfe-history-label-text">
																	<div class="mwp-sfe-block-preview">
																		<p>Our team combines practical experience with a clear focus on long-term client success.</p>
																	</div>
																</div>
															</div>
															<div class="mwp-sfe-history-after">
																<div class="mwp-sfe-history-label">Proposed</div>
																<div class="mwp-sfe-history-label-text">
																	<div class="mwp-sfe-block-preview">
																		<p>Our experienced team helps small businesses build practical, long-term momentum.</p>
																	</div>
																</div>
															</div>
														</div>
														<div class="mwp-sfe-history-actions">
															<button class="button button-small mwp-sfe-approve-draft-btn" style="color:#00a32a;">Approve</button>
															<button class="button button-small mwp-sfe-deny-draft-btn" style="color:#d63638;">Deny</button>
															<button class="button button-small mwp-sfe-edit-draft-btn" style="color:#2271b1;">Edit draft</button>
														</div>
													</div>
													<div class="mwp-sfe-history-entry status-current">
														<div class="mwp-sfe-history-meta">
															<span class="mwp-sfe-history-version">Version 2<small> (Current)</small></span>
															<span class="mwp-sfe-history-date">July 20, 2026 10:40 am</span>
														</div>
														<div class="mwp-sfe-history-user">By: Patrick Bateman</div>
														<div class="mwp-sfe-history-approved">Approved By: Keyser Söze on July 20, 2026 10:45 am</div>
														<div class="mwp-sfe-history-content">
															<div class="mwp-sfe-history-before">
																<div class="mwp-sfe-history-label">Original</div>
																<div class="mwp-sfe-history-label-text">
																	<div class="mwp-sfe-block-preview">
																		<p>We bring practical experience to every client relationship.</p>
																	</div>
																</div>
															</div>
															<div class="mwp-sfe-history-after">
																<div class="mwp-sfe-history-label">Approved</div>
																<div class="mwp-sfe-history-label-text">
																	<div class="mwp-sfe-block-preview">
																		<p>Our team combines practical experience with a clear focus on long-term client success.</p>
																	</div>
																</div>
															</div>
														</div>
														<div class="mwp-sfe-history-actions">
															<a class="button button-small mwp-sfe-view-link">View on page</a>
														</div>
													</div>
													<div class="mwp-sfe-history-entry">
														<div class="mwp-sfe-history-meta">
															<span class="mwp-sfe-history-version">Version 1</span>
															<span class="mwp-sfe-history-date">July 12, 2026 3:30 pm</span>
														</div>
														<div class="mwp-sfe-history-user">By: Keyser Söze</div>
														<div class="mwp-sfe-history-text mwp-sfe-history-original-content" style="background: #f9f9f9; border-left: 3px solid #00a32a;">
															<span class="mwp-sfe-history-original-content-source">Source</span>
															<div class="mwp-sfe-history-label-text">
																<em>Initial version</em>
															</div>
														</div>
														<div class="mwp-sfe-history-content">
															<div class="mwp-sfe-history-before">
																<div class="mwp-sfe-history-label">Before</div>
																<div class="mwp-sfe-history-label-text">
																	<em>No content</em>
																</div>
															</div>
															<div class="mwp-sfe-history-after">
																<div class="mwp-sfe-history-label">After</div>
																<div class="mwp-sfe-history-label-text">
																	<div class="mwp-sfe-block-preview">
																		<p>We bring practical experience to every client relationship.</p>
																	</div>
																</div>
															</div>
														</div>
														<div class="mwp-sfe-history-actions">
															<button class="button button-small mwp-sfe-revert-btn">Revert to this version</button>
														</div>
													</div>
												</div>
											</div>
										</li>
										<li class="mwp-sfe-element-item">
											<div class="mwp-sfe-element-header">
												<div class="mwp-sfe-element-preview">
													<span>We make complex projects easier to manage.</span>
												</div>
												<div class="mwp-sfe-element-stats">
													<span class="status-ok">✓ View Item Timeline</span>
												</div>
											</div>
											<div class="mwp-sfe-history-container">
												<div class="mwp-sfe-loading">Click to load history...</div>
											</div>
										</li>
									</ul>
								</div>
							</div>
						</div>
						<h2 style="margin-top:40px;">Posts</h2>
						<div class="mwp-sfe-post-card">
							<div class="mwp-sfe-post-header">
								<div>
									<h3 class="mwp-sfe-post-title">Preparing for Your First Consultation</h3>
									<h4 class="mwp-sfe-post-id">(ID: 87)</h4>
									<div class="mwp-sfe-post-meta">Last modified: July 18, 2026</div>
								</div>
								<span class="mwp-sfe-element-count">Up to date</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
		<?php
	}

	/**
	 * Render the primary FrontEdit admin page.
	 *
	 * Base provides concise onboarding and a clear compatibility boundary. When
	 * Pro is active, its dashboard is rendered through the established action.
	 *
	 * @return void
	 */
	public function render_dashboard_page(): void {
		echo '<div class="wrap">';

		if ( ! mwpsfe_is_pro_active() ) {
			?>
			<h1>Getting Started with FrontEdit</h1>
			<p>Open a published post, page, or eligible custom post type while logged in to begin editing supported Gutenberg blocks on the live page.</p>

			<div class="card" style="max-width:800px;margin-top:20px;">
				<h2>Start editing</h2>
				<ol>
					<li>Open a published post, page, or custom post type that uses the WordPress block editor, then view it on your site.</li>
					<li>Hover over a supported block, click, and make your change in context.</li>
					<li>Save the update. FrontEdit preserves the block's normal Gutenberg serialization.</li>
				</ol>
			</div>

			<div class="card" style="max-width:800px;margin-top:20px;">
				<h2>Included in FrontEdit</h2>
				<p>All editing controls for FrontEdit's supported blocks, including editing multiple blocks in one session, are included in the Base plugin.</p>
				<p><strong>Supported Core blocks:</strong> Paragraph, Heading, List, Code, Preformatted, Verse, Pullquote, Details, Table, Image, File, Audio, Video, Cover, Media & Text, Icon, Accordion Heading, and Button.</p>
			</div>

			<div class="card" style="max-width:800px;margin-top:20px;">
				<h2>Compatibility</h2>
				<p>FrontEdit edits supported Gutenberg blocks stored in <code>post_content</code> on publicly viewable posts, pages, and custom post types that use the WordPress block editor. ACF, Meta Box, and similar tools are supported when they only register that post type or add fields alongside its normal block content.</p>
				<p>FrontEdit does not edit ACF, Meta Box, or other custom-field values, block-bound post meta, flexible-content layouts, or third-party page-builder content.</p>
			</div>

			<div class="card" style="max-width:800px;margin-top:20px;">
				<h2>What Pro adds</h2>
				<p>Pro adds optional editorial workflows: drafts and approvals, per-user editing controls, ticket-based content-request management, a content catalog, and edit history.</p>
				<p><a href="<?php echo esc_url( MWPSFE_PLUGIN_URI . '?utm_source=mwpsfe_getting_started#compare-free-vs-pro' ); ?>" target="_blank">Compare FrontEdit and FrontEdit Pro</a></p>
			</div>
			<?php
		} else {
			?>
			<h1>Dashboard</h1>
			<?php
			/**
			 * Fires inside the Pro Dashboard page wrap.
			 *
			 * MWPSFEPRO_Dashboard renders the full dashboard when Pro is active.
			 *
			 * @since 1.0.0
			 */
			do_action( 'mwpsfe_render_dashboard_content' );
		}

		echo '</div>';
	}

	private function get_settings_tabs() {
		$tabs = array(
			'email'       => 'Email Notifications',
			'permissions' => 'User Permissions',
			'license'     => 'License',
		);
		return apply_filters( 'mwpsfe_settings_tabs', $tabs );
	}

	public function render_settings_page() {
		$tabs       = $this->get_settings_tabs();
		$valid_tabs = array_keys( $tabs );
		$tab_param  = filter_input( INPUT_GET, 'tab', FILTER_SANITIZE_SPECIAL_CHARS );
		$active_tab = is_string( $tab_param ) && in_array( $tab_param, $valid_tabs, true )
			? sanitize_key( $tab_param )
			: 'email';

		$notice = get_transient( 'mwpsfe_settings_notice_' . get_current_user_id() );
		if ( $notice ) {
			delete_transient( 'mwpsfe_settings_notice_' . get_current_user_id() );
			$type = $notice['type'] ?? 'success';
			$msg  = $notice['message'] ?? '';
			echo '<div class="notice notice-' . esc_attr( $type ) . ' is-dismissible"><p>' . esc_html( $msg ) . '</p></div>';
		}
		?>
		<div class="wrap">
			<h1>Plugin Settings</h1>
			<?php do_action( 'mwpsfe_render_settings_notices' ); ?>
			<?php $this->render_tab_nav( $tabs, $active_tab ); ?>
			<div class="mwp-sfe-settings-tab-content">
				<?php
				switch ( $active_tab ) {
					case 'email':
						do_action( 'mwpsfe_render_settings_email_tab' );
						break;
					case 'permissions':
						$this->render_permissions_tab();
						break;
					case 'catalog':
						do_action( 'mwpsfe_render_settings_catalog_tab' );
						break;
					case 'license':
						$this->render_license_tab();
						break;
					default:
						do_action( 'mwpsfe_render_settings_tab_' . $active_tab );
				}
				?>
			</div>
		</div>
		<?php
	}

	private function render_tab_nav( $tabs, $active_tab ) {
		$base_url = admin_url( 'admin.php?page=' . MWPSFE_SETTINGS_SLUG );
		echo '<nav class="mwp-sfe-settings-nav nav-tab-wrapper">';
		foreach ( $tabs as $slug => $label ) {
			$class = 'nav-tab' . ( $slug === $active_tab ? ' nav-tab-active' : '' );
			echo '<a href="' . esc_url( $base_url . '&tab=' . $slug ) . '" class="' . esc_attr( $class ) . '">' . esc_html( $label ) . '</a>';
		}
		echo '</nav>';
	}

	public function render_email_tab_free_card() {
		$email_address = get_option( 'mwpsfe_request_email_address', '' );
		$from_email    = get_option( 'mwpsfe_request_from_email', '' );
		$has_license   = mwpsfe_is_pro_active();
		$settings_url  = admin_url( 'admin.php?page=' . MWPSFE_SETTINGS_SLUG . '&tab=email' );
		?>
		<form method="post" action="<?php echo esc_url( $settings_url ); ?>">
			<?php wp_nonce_field( 'mwpsfe_free_request_email_action' ); ?>
			<div class="card" style="max-width:800px;margin-top:20px;">
				<h2>Email Settings</h2>
				<p class="description">
					Each content request sends the administrator an immediate, block-linked email. FrontEdit Base does not store or manage request tickets.
					<?php if ( ! $has_license ) : ?>
						<a href="<?php echo esc_url( MWPSFE_PLUGIN_URI . '?utm_source=mwpsfe_email_settings#choose-your-plan' ); ?>" target="_blank">Upgrade to Pro</a>
						to control notification frequency and enable user completion notifications.
					<?php endif; ?>
				</p>
				<table class="form-table">
					<tr>
						<th scope="row"><label for="mwpsfe_request_email_address">Recipient Address</label></th>
						<td>
							<input type="email" id="mwpsfe_request_email_address" name="mwpsfe_request_email_address"
								value="<?php echo esc_attr( $email_address ); ?>" class="regular-text">
							<p class="description">Leave blank to use the WordPress admin email (<code><?php echo esc_html( get_option( 'admin_email' ) ); ?></code>).</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="mwpsfe_request_from_email">From Address</label></th>
						<td>
							<input type="email" id="mwpsfe_request_from_email" name="mwpsfe_request_from_email"
								value="<?php echo esc_attr( $from_email ); ?>" class="regular-text">
							<p class="description">Leave blank to use the default WordPress sending address. Emails are sent as <code><em><?php echo esc_html( get_bloginfo( 'name' ) ); ?> &lt;address&gt;</em></code>.</p>
						</td>
					</tr>
				</table>
				<p class="submit">
					<input type="submit" name="mwpsfe_save_free_request_email" class="button button-primary" value="Save Email Settings">
				</p>
			</div>
		</form>
		<?php
	}

	private function render_permissions_tab() {
		do_action( 'mwpsfe_render_settings_permissions_tab' );
		if ( mwpsfe_is_pro_active() ) {
			return;
		}

		?>
		<div class="card" style="max-width:800px;margin-top:20px;">
			<h2>User Permissions</h2>
			<p>
				In the free version, frontend access follows a fixed role and post-ownership policy.
				Administrators and Editors can edit and comment on content they can edit in WordPress.
				Authors can edit and comment on their own posts. Contributors can submit content
				requests only on their own pending posts. Subscribers and other roles do not receive
				frontend editing assets or access.
			</p>
		</div>
		<div class="mwp-sfe-preview-wrap">
			<div class="mwp-sfe-upgrade-overlay">
				<div class="mwp-sfe-upgrade-overlay-icon">🔒</div>
				<h3 class="mwp-sfe-upgrade-overlay-title">Pro Feature</h3>
				<p class="mwp-sfe-upgrade-overlay-desc">
					Unlock per-user permission and batch-editing controls with a pro license.
				</p>
				<a href="<?php echo esc_url( MWPSFE_PLUGIN_URI . '?utm_source=mwpsfe_user_perms_tab#choose-your-plan' ); ?>" target="_blank"
				   class="button button-primary">
					Upgrade to Pro
				</a>
			</div>
			<div class="mwp-sfe-preview-blur" aria-hidden="true">
				<div class="card" style="max-width:800px;">
					<h2>
						User Permissions
						<span class="mwp-sfe-pro-badge">PRO</span>
					</h2>
					<p class="description">Control each user's editing permissions and whether they can edit multiple blocks in one session.</p>
					<table class="wp-list-table widefat fixed striped">
						<thead>
							<tr>
								<th style="width:25%;">User</th>
								<th style="width:15%;">Role</th>
								<th>Editing Access</th>
							</tr>
						</thead>
						<tbody>
							<?php
							$preview_users = array(
								array( 'name' => 'Thomas Anderson', 'login' => 'neo',            'role' => 'administrator', 'custom' => false, 'batch' => true  ),
								array( 'name' => 'Tyler Durden',    'login' => 'tdurden',        'role' => 'author',        'custom' => true,  'batch' => false ),
								array( 'name' => 'Keyser Söze',     'login' => 'verbal',         'role' => 'contributor',   'custom' => false, 'batch' => false ),
								array( 'name' => 'Patrick Bateman', 'login' => 'huey_lewis_fan', 'role' => 'editor',        'custom' => true,  'batch' => true  ),
							);
							foreach ( $preview_users as $pu ) :
							?>
							<tr>
								<td>
									<strong><?php echo esc_html( $pu['name'] ); ?></strong><br>
									<span class="mwp-sfe-user-meta"><?php echo esc_html( $pu['login'] ); ?></span>
								</td>
								<td><?php echo esc_html( $pu['role'] ); ?></td>
								<td>
									<div class="mwp-sfe-perm-options-wrap">
										<div class="mwp-sfe-perm-setting">
											<input type="checkbox" class="mwp-sfe-perm-toggle-input" <?php checked( $pu['custom'] ); ?>>
											<label class="mwp-sfe-perm-setting-row">
												<span class="mwp-sfe-perm-setting-copy">
													<strong>Custom permissions</strong>
													<span class="mwp-sfe-perm-option-desc">Override the user's default WordPress role permissions.</span>
												</span>
												<span class="mwp-sfe-perm-switch" aria-hidden="true"></span>
											</label>
											<div class="mwp-sfe-perm-custom-options">
												<p class="mwp-sfe-perm-custom-title">Select permissions</p>
												<label class="mwp-sfe-perm-item"><input type="checkbox"> <strong>Restricted</strong> - Cannot edit or submit content requests</label>
												<label class="mwp-sfe-perm-item"><input type="checkbox" checked> <strong>Comment</strong> - Create content requests</label>
												<label class="mwp-sfe-perm-item"><input type="checkbox"> <strong>Publish</strong> - Apply changes immediately</label>
												<label class="mwp-sfe-perm-item"><input type="checkbox" checked> <strong>Draft</strong> - Submit for admin review</label>
												<p class="mwp-sfe-perm-note"><strong>Note:</strong> Restricted is selected by default when no other custom permissions are enabled. Publish and Draft cannot be selected together.</p>
											</div>
										</div>
										<div class="mwp-sfe-perm-setting">
											<input type="checkbox" class="mwp-sfe-perm-toggle-input" <?php checked( $pu['batch'] ); ?>>
											<label class="mwp-sfe-perm-setting-row">
												<span class="mwp-sfe-perm-setting-copy">
													<strong>Batch editing</strong>
													<span class="mwp-sfe-perm-option-desc">Allow this user to edit multiple blocks in one session.</span>
												</span>
												<span class="mwp-sfe-perm-switch" aria-hidden="true"></span>
											</label>
										</div>
									</div>
								</td>
							</tr>
							<?php endforeach; ?>
						</tbody>
					</table>
					<p class="submit"><input type="submit" class="button button-primary" value="Save Permissions"></p>
				</div>
			</div>
		</div>
		<?php
	}

	private function render_license_tab() {
		if ( mwpsfepro_class_exists() ) {
			do_action( 'mwpsfe_render_pro_license_tab' );
			return;
		}
		$upgrade_url = MWPSFE_PLUGIN_URI . '?utm_source=mwpsfe_license_tab#choose-your-plan';
		?>
		<div class="card" style="max-width:800px;margin-top:20px;">
			<h2>License</h2>
			<div id="mwp-sfe-state-notice" class="notice inline notice-info"><p id="mwp-sfe-state-notice-text">You're using the free version of FrontEdit. Click below to upgrade to Pro.</p></div>
			<div id="mwp-sfe-action-notice-container" style="margin-top:20px;"></div>
			<table class="form-table"><tr><th scope="row"><label for="mwp-sfe-license-key-input">License Key</label></th><td>
				<div style="display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;">
					<input type="text" id="mwp-sfe-license-key-input" value="" class="regular-text" placeholder="Enter your license key" style="margin:0;" autocomplete="off">
					<span id="mwp-sfe-license-badge" class="mwp-sfe-license-status-badge" style="display:none;"><span class="mwp-sfe-license-status-dot" aria-hidden="true"></span><span class="mwp-sfe-license-status-label">No License</span></span>
				</div>
			</td></tr></table>
			<p class="submit"><button type="button" id="mwp-sfe-license-save-btn" class="button button-primary" data-upgrade-url="<?php echo esc_url( $upgrade_url ); ?>">Save &amp; Verify License</button></p>
			<h2 style="margin-top:30px;">Feature Overview</h2>
			<table class="widefat" style="max-width:600px;margin-bottom:15px;"><thead><tr><th>Feature</th><th>Free</th><th>Pro</th></tr></thead><tbody>
				<tr><td>Frontend inline editing</td><td>✓</td><td>✓</td></tr><tr><td>Content requests (comments)</td><td>✓</td><td>✓</td></tr><tr><td>Simple per-request admin email</td><td>✓</td><td>✓</td></tr><tr><td>Batch editing</td><td>✓</td><td>✓</td></tr><tr><td>Custom per-user single or batch editing controls</td><td>-</td><td>✓</td></tr><tr><td>Content request ticket system</td><td>-</td><td>✓</td></tr><tr><td>Notification frequency controls</td><td>-</td><td>✓</td></tr><tr><td>User completion notifications</td><td>-</td><td>✓</td></tr><tr><td>Content Catalog</td><td>-</td><td>✓</td></tr><tr><td>Version history &amp; revert</td><td>-</td><td>✓</td></tr><tr><td>Catalog edit notifications</td><td>-</td><td>✓</td></tr><tr><td>User permissions management</td><td>-</td><td>✓</td></tr>
			</tbody></table>
			<a href="<?php echo esc_url( $upgrade_url ); ?>" target="_blank" class="button button-primary" style="margin-bottom:15px;">Upgrade to Pro</a>
		</div>
		<?php
	}

	/**
	 * Returns a standardized email subject with site name prefix.
	 *
	 * All plugin emails use this method to build their subject lines, so
	 * the format can be changed in one place. The current format is:
	 *   [Site Name] Subject Body
	 *
	 * @param string $subject The subject body (without site name).
	 * @return string Formatted subject.
	 */
	public static function email_subject( $subject ) {
		return '[' . get_bloginfo( 'name' ) . '] ' . $subject;
	}

	/**
	 * Store a settings page notice. Call before wp_safe_redirect() in admin_init handlers.
	 *
	 * @param string $message
	 * @param string $type 'success'|'error'|'warning'|'info'
	 */
	public static function set_settings_notice( $message, $type = 'success' ) {
		set_transient( 'mwpsfe_settings_notice_' . get_current_user_id(), array( 'message' => $message, 'type' => $type ), 60 );
	}

	/**
	 * Verify a settings-form nonce and gracefully recover from an expired page.
	 *
	 * WordPress' check_admin_referer() helper terminates the request with
	 * wp_nonce_ays() when the submitted nonce is stale. That is secure, but it
	 * creates a poor UX for this plugin's settings forms because browsers can
	 * restore an older admin page from cache without performing a fresh request.
	 *
	 * This helper preserves the nonce verification requirement while redirecting
	 * back to the relevant settings tab with a dismissible notice instead of a
	 * fatal "The link you followed has expired" screen. The user can then retry
	 * the save against a fresh nonce from the reloaded page.
	 *
	 * @param string $action        Nonce action expected for the submitted form.
	 * @param string $redirect_url  Settings URL to return the user to on failure.
	 * @param string $expired_notice Notice shown after redirect when the nonce is invalid.
	 * @return bool True when the nonce is valid. This method exits after redirect on failure.
	 */
	public static function verify_settings_form_nonce_or_redirect( $action, $redirect_url, $expired_notice ) {
		$nonce = isset( $_POST['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_POST['_wpnonce'] ) ) : '';

		if ( $nonce !== '' && wp_verify_nonce( $nonce, $action ) ) {
			return true;
		}

		self::set_settings_notice( $expired_notice, 'warning' );
		wp_safe_redirect( $redirect_url );
		exit;
	}

	/**
	 * Schedule or reschedule a set of digest cron events at admin-configured
	 * local-timezone times.
	 *
	 * Centralizes the scheduling algorithm previously duplicated across
	 * MWPSFEPRO_Content_Requests and MWPSFEPRO_Catalog.
	 * Each caller passes its own event definitions array; this method owns
	 * all scheduling logic.
	 *
	 * Design note: PHP ignores the timezone argument when constructing a
	 * DateTime from a Unix timestamp ("@" prefix). setTimezone() must be
	 * called separately after construction to obtain the correct local hour.
	 *
	 * @param array[] $events {
	 *     @type string   $hook        WP-Cron action hook name.
	 *     @type string   $option      Option key storing the configured hour (0-23).
	 *     @type int      $default     Default hour when the option has not been saved.
	 *     @type string   $recurrence  WP-Cron recurrence slug ('daily' or 'weekly').
	 *     @type int|null $weekday     ISO weekday (1=Mon...7=Sun), or null for daily.
	 * }
	 */
	public static function schedule_digest_events( array $events ) {
		$timezone     = wp_timezone();
		$current_time = new DateTime( 'now', $timezone );

		foreach ( $events as $event ) {
			$configured_hour  = (int) get_option( $event['option'], $event['default'] );
			$needs_reschedule = false;
			$next_ts          = wp_next_scheduled( $event['hook'] );

			if ( $next_ts ) {
				// Build from UTC timestamp then apply local timezone.
				$scheduled_dt = new DateTime( '@' . $next_ts );
				$scheduled_dt->setTimezone( $timezone );

				$hour_ok = ( (int) $scheduled_dt->format( 'G' ) === $configured_hour );
				$day_ok  = ( $event['weekday'] === null )
					? true
					: ( (int) $scheduled_dt->format( 'N' ) === $event['weekday'] );

				if ( ! $hour_ok || ! $day_ok ) {
					wp_unschedule_event( $next_ts, $event['hook'] );
					$needs_reschedule = true;
				}
			} else {
				$needs_reschedule = true;
			}

			if ( ! $needs_reschedule ) {
				continue;
			}

			$next_dt = clone $current_time;
			$next_dt->setTime( $configured_hour, 0, 0 );

			if ( $event['weekday'] !== null ) {
				$current_day = (int) $next_dt->format( 'N' );
				if ( $current_day < $event['weekday'] ) {
					$next_dt->modify( '+' . ( $event['weekday'] - $current_day ) . ' days' );
				} elseif ( $current_day === $event['weekday'] ) {
					if ( $next_dt <= $current_time ) {
						$next_dt->modify( '+7 days' );
					}
				} else {
					$next_dt->modify( '+' . ( 7 - $current_day + $event['weekday'] ) . ' days' );
				}
			} else {
				if ( $next_dt <= $current_time ) {
					$next_dt->modify( '+1 day' );
				}
			}

			wp_schedule_event( $next_dt->getTimestamp(), $event['recurrence'], $event['hook'] );
		}
	}

	/** Filter: mwpsfe_notification_admin_email - returns the To address. */
	public function filter_admin_email( $email ) {
		$custom = get_option( 'mwpsfe_request_email_address', '' );
		return ! empty( $custom ) ? $custom : get_option( 'admin_email' );
	}

	/** Filter: mwpsfe_notification_from_email - returns formatted From header. */
	public function filter_from_email( $from ) {
		$site_name = get_bloginfo( 'name' );
		$custom    = get_option( 'mwpsfe_request_from_email', '' );
		$address   = ! empty( $custom ) ? $custom : 'wordpress@' . wp_parse_url( network_home_url(), PHP_URL_HOST );
		return $site_name . ' <' . $address . '>';
	}

	/** Filter: mwpsfe_email_template - wraps content in HTML email shell. */
	public function filter_email_template( $html, $args ) {
		$args = wp_parse_args( $args, array( 'title' => '', 'content' => '', 'footer' => '' ) );

		// Print this registered stylesheet directly into the standalone email head.
		// Critical layout styles remain inline because many email clients do not load
		// external stylesheets, while compatible clients can use the shared asset.
		wp_enqueue_style(
			'mwpsfe-email',
			MWPSFE_PLUGIN_URL . 'includes/assets/css/email.css',
			array(),
			MWPSFE_VERSION
		);

		ob_start();
		wp_print_styles( array( 'mwpsfe-email' ) );
		$email_head_styles = (string) ob_get_clean();

		$out  = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
			. '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
			. $email_head_styles
			. '</head>';

		// Outer wrapper – full-width background, vertically padded.
		// .wrap, .mwp-sfe-settings-tab-content, .mwp-sfe-catalog-wrap
		$out .= '<body style="margin:0;padding:0;background:#f0f0f1;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;">';
		// Admin page background/wrap chrome.
		$out .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f1;">';
		// Outer admin page spacing/gutters.
		$out .= '<tr><td align="center" style="padding:40px 20px;">';

		// Inner card – capped at 600 px but fluid on narrow viewports.
		// .mwp-sfe-summary-card, .mwp-sfe-request-post-card, .mwp-sfe-media-card
		$out .= '<table role="presentation" cellpadding="0" cellspacing="0" '
			. 'width="600" '
			. 'style="width:600px;max-width:100%;background:#fff;border:1px solid #ccd0d4;border-radius:8px;border-collapse:separate;'
			. 'box-shadow:0 10px 15px -3px rgba(0, 0, 0, .1), 0 4px 6px 0 rgba(0, 0, 0, .05);overflow:hidden;">';

		// Header row.
		$out .= '<tr><td style="padding:20px 30px;background:#f6f7f7;border-bottom:1px solid #ccd0d4;">'
			. '<h1 style="margin:0;font-size:20px;font-weight:600;color:#1d2327;">'
			. esc_html( $args['title'] )
			. '</h1></td></tr>';

		// Content row – word-break/overflow-wrap prevent long strings blowing out the layout.
		// 10px bottom padding to account for 20px margin of each content card
		$out .= '<tr><td style="padding:30px 30px 10px 30px;word-break:break-word;overflow-wrap:anywhere;">'
			. $args['content']
			. '</td></tr>';

		// Top border for footer.
		$out .= '<tr><td style="border-top:1px solid #ccd0d4;"></td></tr>';

		// Optional footer link row.
		if ( ! empty( $args['footer'] ) ) {
			$out .= '<tr><td style="padding:15px 30px 0;background:#f6f7f7;'
				. 'text-align:center;font-size:13px;color:#787c82;">'
				. $args['footer']
				. '</td></tr>';
		}

		// Disclaimer row.
		$out .= '<tr><td style="background:#f6f7f7;padding:15px 30px;text-align:center;">'
			. '<em style="font-size:11px;color:#a7aaad;">'
			. 'Styles may not display accurately in all email clients. '
			. 'For the best experience, view the content on the website.'
			. '</em></td></tr>';

		$out .= '</table></td></tr></table></body></html>';
		return $out;
	}

}
