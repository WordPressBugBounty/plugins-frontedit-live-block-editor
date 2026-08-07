/**
 * Base license-tab prompt behavior.
 *
 * This free-plugin asset intentionally performs no license validation or
 * network request. FrontEdit Pro owns the validation pipeline.
 *
 * Reads: window.mwpSfeLicensePrompt, base License-tab DOM elements.
 * Exposes: none.
 */
( function() {
	'use strict';

	function createNotice( type ) {
		var notice = document.createElement( 'div' );
		notice.className = 'notice notice-' + type + ' inline';
		notice.id = 'mwp-sfe-action-notice';
		notice.style.position = 'relative';
		notice.style.marginBottom = '15px';
		return notice;
	}

	function showNotice( key, upgradeUrl ) {
		var container = document.getElementById( 'mwp-sfe-action-notice-container' );
		if ( ! container ) {
			return;
		}

		container.textContent = '';
		var notice = createNotice( key ? 'warning' : 'error' );
		var paragraph = document.createElement( 'p' );

		if ( key ) {
			paragraph.appendChild( document.createTextNode( 'Install and activate FrontEdit Pro to validate this license key, or ' ) );
			var link = document.createElement( 'a' );
			link.href = upgradeUrl;
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
			link.textContent = 'get FrontEdit Pro';
			paragraph.appendChild( link );
			paragraph.appendChild( document.createTextNode( '.' ) );
		} else {
			paragraph.textContent = 'Please enter a license key before validating.';
		}

		notice.appendChild( paragraph );
		container.appendChild( notice );
	}

	function init() {
		var config = window.mwpSfeLicensePrompt;
		var input = document.getElementById( 'mwp-sfe-license-key-input' );
		var button = document.getElementById( 'mwp-sfe-license-save-btn' );

		if ( ! config || ! input || ! button ) {
			return;
		}

		button.addEventListener( 'click', function() {
			showNotice( input.value.trim(), config.upgradeUrl );
		} );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();
