/**
 * Element preparation helpers for clean HTML/content extraction.
 *
 * Exposes: SFE.ElementPrep
 */
(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	const LEGACY_INLINE_TAG_MAP     = { b: 'strong', i: 'em', strike: 's' };
	const EMPTY_INLINE_SELECTOR     = 'a, b, strong, i, em, s, strike, u, span, code, mark, sub, sup, small';
	const MEANINGFUL_EMBED_SELECTOR = 'img, audio, video, iframe, embed, object, svg, canvas, hr, input, textarea, select, button, table';
	const GHOST_SELECTOR            = '[data-mwp-sfe-ghost="1"]';

	function sanitizedTextContent(node) {
		return String(node?.textContent || '')
			.replace(/\uFEFF/g, '')
			.replace(/\u00A0/g, ' ')
			.trim();
	}

	function replaceTag(element, newTagName) {
		if (!element || element.nodeType !== Node.ELEMENT_NODE) return element;

		const replacement = document.createElement(newTagName);
		Array.from(element.attributes || []).forEach(attr => {
			replacement.setAttribute(attr.name, attr.value);
		});

		while (element.firstChild) {
			replacement.appendChild(element.firstChild);
		}

		if (element.parentNode) {
			element.parentNode.replaceChild(replacement, element);
		}

		return replacement;
	}

	function hasMeaningfulElementContent(element) {
		if (!element) return false;
		if (sanitizedTextContent(element).length > 0) return true;
		return !!element.querySelector?.(MEANINGFUL_EMBED_SELECTOR);
	}

	function normalizeRichTextMarkup(rootElement) {
		if (!rootElement || typeof rootElement.querySelectorAll !== 'function') {
			return;
		}

		Object.entries(LEGACY_INLINE_TAG_MAP).forEach(([fromTag, toTag]) => {
			Array.from(rootElement.querySelectorAll(fromTag)).forEach(node => {
				replaceTag(node, toTag);
			});
		});

		const depthOf = (node) => {
			let depth  = 0;
			let cursor = node;
			while (cursor && cursor !== rootElement) {
				cursor = cursor.parentElement;
				depth++;
			}
			return depth;
		};

		Array.from(rootElement.querySelectorAll(EMPTY_INLINE_SELECTOR))
			.sort((a, b)  => depthOf(b) - depthOf(a))
			.forEach(node => {
				if (!node?.isConnected) return;
				if (node.hasAttribute?.('data-rich-text-placeholder')) return;
				if (hasMeaningfulElementContent(node)) return;
				node.remove();
			});

		if (typeof rootElement.normalize === 'function') {
			rootElement.normalize();
		}
	}

	/**
	 * Strip placeholder presentation from one cloned rich-text subtree without
	 * removing the structural host element itself.
	 *
	 * Empty editable surfaces such as table cells carry the same
	 * `data-rich-text-placeholder` attribute as the placeholder span used for
	 * visual UI. History snapshots must remove the visual placeholder artifacts
	 * while preserving the underlying structural element so empty cells/captions
	 * remain part of the canonical block markup.
	 *
	 * @param {HTMLElement} rootElement Cloned subtree being cleaned for storage.
	 * @returns {void}
	 */
	function stripRichTextPlaceholderPresentation(rootElement) {
		if (!rootElement || rootElement.nodeType !== Node.ELEMENT_NODE) {
			return;
		}

		rootElement
			.querySelectorAll('.mwp-sfe-rich-text-placeholder[data-rich-text-placeholder]')
			.forEach(placeholder => {
				placeholder.remove();
			});

		const placeholderHosts = [];
		if (rootElement.hasAttribute?.('data-rich-text-placeholder')) {
			placeholderHosts.push(rootElement);
		}

		rootElement.querySelectorAll('[data-rich-text-placeholder]').forEach(node => {
			if (
				node?.nodeType === Node.ELEMENT_NODE &&
				!node.classList.contains('mwp-sfe-rich-text-placeholder')
			) {
				placeholderHosts.push(node);
			}
		});

		placeholderHosts.forEach(host => {
			Array.from(host.childNodes || []).forEach(child => {
				if (!child || child.nodeType !== Node.TEXT_NODE) {
					return;
				}

				const sanitized = String(child.textContent || '')
					.replace(/\uFEFF/g, '')
					.replace(/\u00A0/g, ' ')
					.trim();
				if (!sanitized.length) {
					child.remove();
				}
			});

			if (typeof host.normalize === 'function') {
				host.normalize();
			}
		});
	}

	const ElementPrep = {
		/**
		 * Remove an empty class attribute from a node.
		 *
		 * Browsers can leave a bare `class` attribute after classList mutations
		 * when every token has been removed. This normalizes that case by
		 * removing `class` entirely once no class tokens remain.
		 *
		 * @param {HTMLElement} node Element to normalize.
		 * @returns {void}
		 */
		pruneEmptyClassAttribute(node) {
			if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
			if (!node.hasAttribute('class')) return;
			if (node.classList.length > 0) return;
			node.removeAttribute('class');
		},

		/**
		 * Check whether a class is plugin/runtime state.
		 *
		 * @param {string} className Class token.
		 * @returns {boolean}
		 */
		isPluginClass(className) {
			return this.PLUGIN_CLASSES.includes(className);
		},

		/**
		 * Check whether an attribute is plugin/runtime state.
		 *
		 * Identity attrs are treated separately because callers may choose
		 * whether to preserve them.
		 *
		 * @param {string} attrName Attribute name.
		 * @returns {boolean}
		 */
		isPluginAttr(attrName) {
			return this.PLUGIN_ATTRS.includes(String(attrName || '').toLowerCase());
		},

		/**
		 * Get a className string with plugin/runtime classes removed.
		 *
		 * @param {HTMLElement} element Element to inspect.
		 * @returns {string}
		 */
		getPersistentClassName(element) {
			if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';

			return Array.from(element.classList || [])
				.filter(className => !this.isPluginClass(className))
				.join(' ');
		},

		/**
		 * Get the current runtime/plugin-managed classes on an element.
		 *
		 * History restore should preserve these live session classes instead of
		 * trying to store them in content history snapshots.
		 *
		 * @param {HTMLElement} element Element to inspect.
		 * @returns {string[]} Runtime class tokens.
		 */
		getRuntimeClassNames(element) {
			if (!element || element.nodeType !== Node.ELEMENT_NODE) return [];

			return Array.from(element.classList || [])
				.filter(className => this.isPluginClass(className));
		},

		/**
		 * Get root attributes for history snapshots.
		 *
		 * This keeps real content attrs like href, target, rel, style, aria-*,
		 * etc., while removing editor/runtime attrs.
		 *
		 * @param {HTMLElement} element Element to inspect.
		 * @param {Object} options Options.
		 * @returns {Object}
		 */
		getPersistentAttributes(element, options = {}) {
			const {
				keepIdentity = true
			} = options;

			const attrs = {};

			if (!element || element.nodeType !== Node.ELEMENT_NODE) {
				return attrs;
			}

			Array.from(element.attributes || []).forEach(attr => {
				const name = attr.name.toLowerCase();

				if (this.isPluginAttr(name)) {
					return;
				}

				if (!keepIdentity && this.IDENTITY_ATTRS.includes(name)) {
					return;
				}

				if (name === 'class') {
					const className = this.getPersistentClassName(element);
					if (className) {
						attrs.class = className;
					}
					return;
				}

				attrs[attr.name] = attr.value;
			});

			return attrs;
		},

		/**
		 * Get runtime/plugin-managed attributes that should survive history restore.
		 *
		 * This preserves live editor-session state such as identity tokens,
		 * contenteditable wiring, and other plugin-owned attrs without storing
		 * them as part of the persistent block history payload.
		 *
		 * @param {HTMLElement} element Element to inspect.
		 * @param {Object}      options Options.
		 * @returns {Object} Runtime attribute map.
		 */
		getRuntimeAttributes(element, options = {}) {
			const {
				keepIdentity = true
			} = options;

			const attrs = {};

			if (!element || element.nodeType !== Node.ELEMENT_NODE) {
				return attrs;
			}

			Array.from(element.attributes || []).forEach(attr => {
				const name = attr.name.toLowerCase();
				const isIdentityAttr = keepIdentity && this.IDENTITY_ATTRS.includes(name);
				const isRuntimeAttr = (
					this.isPluginAttr(name) ||
					isIdentityAttr ||
					name.startsWith('data-mwp-sfe-')
				);

				if (!isRuntimeAttr || name === 'class') {
					return;
				}

				attrs[attr.name] = attr.value;
			});

			return attrs;
		},

		/**
		 * Plugin-specific classes that should be removed for clean content
		 */
		PLUGIN_CLASSES: [
			'mwp-sfe-editor-content',
			'mwp-sfe-inline-editor',
			'mwp-sfe-element-active',
			'mwp-sfe-editing-active',
			'mwp-sfe-commenting-active',
			'mwp-sfe-draft-active',
			'mwp-sfe-editing-disabled',
			'mwp-sfe-status-pending',
			'mwp-sfe-ghost-component',
			'mwp-sfe-rich-text-has-placeholder',
			'mwp-sfe-rich-text-show-placeholder',
			'mwp-sfe-component-active',
			'mwp-sfe-editable-component',
			'mwp-sfe-list-select-all-pending'
		],
		
		/**
		 * Plugin-specific attributes that should be removed for clean content
		 */
		PLUGIN_ATTRS: [
			'contenteditable',
			'spellcheck',
			'data-list-id',
			'data-item-id',
			'data-mwp-sfe-ghost',
			'data-mwp-sfe-ghost-component',
			'data-rich-text-placeholder',
			'data-mwp-sfe-active-component',
			'data-mwp-sfe-editable-component'
		],
		
		/**
		 * Identity attributes that should be preserved
		 */
		IDENTITY_ATTRS: [
			'data-mwp-sfe-uuid',
			'data-mwp-sfe-bound'
		],
		
		/**
		 * Clean an element of plugin artifacts
		 * @param {HTMLElement} element - Element to clean (will be cloned, original unchanged)
		 * @param {Object} options - Cleaning options
		 */
		clean(element, options = {}) {
			const {
				removeIdentity = false,
				removeControls = true,
				clone          = true
			} = options;
			
			const el = clone ? element.cloneNode(true) : element;
			
			// Remove control elements
			if (removeControls) {
				el.querySelectorAll('[data-mwp-sfe-control]').forEach(ctrl => ctrl.remove());
			}

			el.querySelectorAll(GHOST_SELECTOR).forEach(ghost => {
				ghost.remove();
			});
			stripRichTextPlaceholderPresentation(el);
			normalizeRichTextMarkup(el);
			
			const nodes = [el, ...el.querySelectorAll('*')];
			nodes.forEach(node => {
				if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

				this.PLUGIN_CLASSES.forEach(cls => node.classList.remove(cls));
				this.PLUGIN_ATTRS.forEach(attr => node.removeAttribute(attr));
				this.pruneEmptyClassAttribute(node);

				if (removeIdentity) {
					this.IDENTITY_ATTRS.forEach(attr => node.removeAttribute(attr));
				}
			});
			
			return el;
		},
		
		/**
		 * Get clean outerHTML for storage/comparison
		 */
		getCleanHTML(element, keepIdentity = false) {
			const cleaned = this.clean(element, { 
				removeIdentity: !keepIdentity,
				removeControls: true,
				clone:          true
			});
			let html = cleaned.outerHTML;
			// Decode Unicode-escaped hyphens in CSS custom properties
			html = html.replace(/\\u002d/gi, '-');
			return html;
		},
		
		/**
		 * Get content based on content type
		 */
		getContent(element, contentType) {
			const cleaned = this.clean(element, { 
				removeIdentity: true,
				removeControls: true,
				clone:          true
			});
			
			switch(contentType) {
				case 'text':
					// For code blocks, extract from <code> tag if nested in <pre>
					if (cleaned.tagName === 'PRE') {
						const code = cleaned.querySelector('code');
						if (code) {
							return code.innerHTML;
						}
						return cleaned.innerHTML;
					}
					return cleaned.innerHTML;
					
				case 'media':
					const tag = cleaned.tagName.toLowerCase();
					const tagAttrMap = { 'img': 'src', 'audio': 'src', 'video': 'src', 'a': 'href' };
					
					if (tagAttrMap[tag]) {
						return cleaned[tagAttrMap[tag]] || cleaned.getAttribute(tagAttrMap[tag]) || '';
					}
					
					// Find child media element
					for (const [childTag, attr] of Object.entries(tagAttrMap)) {
						const el = cleaned.querySelector(childTag);
						if (el) return el[attr] || el.getAttribute(attr) || '';
					}
					return '';
									
				default:
					return cleaned.textContent.trim();
			}
		}
	};

	// Expose globally
	SFE.ElementPrep = ElementPrep;

})();
