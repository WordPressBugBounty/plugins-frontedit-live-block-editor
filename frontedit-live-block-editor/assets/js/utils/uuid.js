/**
 * Client-side UUID generation for elements without server UUIDs
 *
 * Exposes: SFE.GenerateClientUuid
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	/**
	 * Generate a deterministic UUID for elements without server UUIDs
	 * @deprecated no longer generate client UUIDs on the frontend. Use server-side UUIDs instead.
	 */
	function generateClientUuid(postId, typeCode, element) {
		// Get clean content from element (remove FrontEdit controls first)
		const clone = element.cloneNode(true);
		clone.querySelectorAll('[data-mwp-sfe-control]').forEach(el => el.remove());
		const content = clone.textContent.trim().replace(/\s+/g, ' ');
		
		// Generate deterministic UUID based on content
		const hashInput = postId + '|' + typeCode + '|' + content;
		
		// Simple hash function
		let hash = 0;
		for (let i = 0; i < hashInput.length; i++) {
			const char = hashInput.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		
		// Convert to base62 string
		const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
		let result = '';
		let num = hash >>> 0; // Convert to unsigned 32-bit
		for (let i = 0; i < 16; i++) {
			result += chars[num % 62];
			num = Math.floor(num / 62);
			if (num === 0) num = (hash >>> 0); // Reset if depleted
		}
		
		return postId + '-' + typeCode + '-' + result;
	}

	SFE.GenerateClientUuid = generateClientUuid;

})();