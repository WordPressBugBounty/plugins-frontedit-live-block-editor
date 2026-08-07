/**
 * Block editor UUID synchronization for supported block types.
 *
 * Reads:
 *   wp.blocks.isUnmodifiedDefaultBlock - identifies Gutenberg's transient default block
 *   wp.data                            - block-editor store selectors, dispatch, and subscription
 *   wp.hooks.addFilter                 - block-type attribute registration
 *   window.mwpSfeEditorData.pristineDefaultBlocks - schema-declared transient default block types
 *
 * Exposes: SFE.BlockEditorUuid
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	// Get data from PHP.
	const { supportedMap, pristineDefaultBlocks, currentPostId } = window.mwpSfeEditorData || {};

	if (!supportedMap || !pristineDefaultBlocks || !currentPostId) {
		console.error('FrontEdit Manager: Missing editor data');
		return;
	}

	const supportedBlocks = Object.keys(supportedMap);
	const uuidAttr        = { type: 'string', default: '' };
	const { addFilter }   = wp.hooks;

	// --- A. Attribute Registration ---
	/**
	 * Register the UUID attrs on supported block types.
	 *
	 * @param   {Object} settings Gutenberg block settings.
	 * @param   {string} name     Block name.
	 * @returns {Object}          Updated block settings.
	 */
	function addUuidAttribute(settings, name) {
		if (supportedBlocks.includes(name)) {
			// Hoist UUID attrs to the front of the schema object.
			const { mwpSfeUuid: existingUuid, mwpSfeUuidShadow: existingShadow, ...restAttrs } =
				settings.attributes || {};
			const uuid = existingShadow !== undefined ? existingShadow :
				existingUuid !== undefined ? existingUuid :
					uuidAttr;
			settings.attributes = {
				mwpSfeUuid:       uuid,
				mwpSfeUuidShadow: uuid,
				...restAttrs,
			};
		}
		return settings;
	}
	addFilter('blocks.registerBlockType', 'mwp-sfe/add-uuid-attribute', addUuidAttribute);

	// --- B. UUID Management (Strict Format Enforcement) ---
	if (!SFE.blockEditorUuidRegistry) { SFE.blockEditorUuidRegistry = {}; }
	if (!SFE.blockEditorListOwnershipRegistry) { SFE.blockEditorListOwnershipRegistry = {}; }

	/**
	 * Return the block-editor selector when it is available.
	 *
	 * @returns {Object|null} Block editor selector, or null when unavailable.
	 */
	function getBlockEditorSelect() {
		if (!wp?.data?.select) {
			return null;
		}

		return wp.data.select('core/block-editor');
	}

	/**
	 * Return the current top-level editor blocks when the store is available.
	 *
	 * @returns {Array} Top-level block list.
	 */
	function getEditorBlocks() {
		const select = getBlockEditorSelect();
		if (!select || typeof select.getBlocks !== 'function') {
			return [];
		}

		return select.getBlocks() || [];
	}

	/**
	 * Return the live client ID registered to a UUID, pruning stale entries.
	 *
	 * @param   {string} uuid Candidate UUID.
	 * @returns {string}      Live owning client ID, or an empty string.
	 */
	function getRegisteredClient(uuid) {
		const candidate = typeof uuid === 'string' ? uuid.trim() : '';
		if (!candidate) {
			return '';
		}

		const registeredClient = SFE.blockEditorUuidRegistry[candidate];
		if (!registeredClient) {
			return '';
		}

		const select = getBlockEditorSelect();
		if (!select || typeof select.getBlock !== 'function') {
			return registeredClient;
		}

		if (select.getBlock(registeredClient)) {
			return registeredClient;
		}

		delete SFE.blockEditorUuidRegistry[candidate];
		return '';
	}

	/**
	 * Release a UUID registry entry only when it still belongs to this client.
	 *
	 * @param {string} uuid     Candidate UUID to release.
	 * @param {string} clientId Gutenberg client ID expected to own the UUID.
	 * @returns {void}
	 */
	function releaseUuidOwnership(uuid, clientId) {
		const candidate = typeof uuid === 'string' ? uuid.trim() : '';
		if (!candidate) {
			return;
		}

		if (SFE.blockEditorUuidRegistry[candidate] === clientId) {
			delete SFE.blockEditorUuidRegistry[candidate];
		}
	}

	/**
	 * Return true when a block is a nested core/list living under a list item.
	 *
	 * @param   {string} clientId Gutenberg client ID for the current block.
	 * @param   {string} name     Block name.
	 * @returns {boolean}         True when the block must remain non-owning.
	 */
	function isNonOwningNestedListBlock(clientId, name) {
		if (name !== 'core/list') {
			return false;
		}

		const select = getBlockEditorSelect();
		if (!select || typeof select.getBlockParents !== 'function' || typeof select.getBlock !== 'function') {
			return false;
		}

		const parentIds = select.getBlockParents(clientId) || [];
		return parentIds.some(parentId => select.getBlock(parentId)?.name === 'core/list-item');
	}

	/**
	 * Remember the canonical owner UUID associated with a list client ID.
	 *
	 * @param {string} clientId Gutenberg client ID.
	 * @param {string} uuid     Canonical owner UUID, or empty to clear.
	 * @returns {void}
	 */
	function rememberListOwner(clientId, uuid) {
		const ownerUuid = typeof uuid === 'string' ? uuid.trim() : '';
		if (!ownerUuid) {
			delete SFE.blockEditorListOwnershipRegistry[clientId];
			return;
		}

		SFE.blockEditorListOwnershipRegistry[clientId] = ownerUuid;
	}

	/**
	 * Find the owning root list UUID for a nested list block.
	 *
	 * @param   {string} clientId Gutenberg client ID for the nested list block.
	 * @returns {string}          Root list UUID for adoption, or empty.
	 */
	function getInheritedListOwnerUuid(clientId) {
		const select = getBlockEditorSelect();
		if (!select || typeof select.getBlockParents !== 'function' || typeof select.getBlock !== 'function') {
			return SFE.blockEditorListOwnershipRegistry[clientId] || '';
		}

		const parentIds = select.getBlockParents(clientId) || [];
		for (const parentId of parentIds) {
			const parentBlock = select.getBlock(parentId);
			if (!parentBlock || parentBlock.name !== 'core/list') {
				continue;
			}

			const parentAttrs = parentBlock.attributes || {};
			const ownerUuid = String(
				parentAttrs.mwpSfeUuid
				|| parentAttrs.mwpSfeUuidShadow
				|| SFE.blockEditorListOwnershipRegistry[parentId]
				|| ''
			).trim();

			if (ownerUuid) {
				return ownerUuid;
			}
		}

		return SFE.blockEditorListOwnershipRegistry[clientId] || '';
	}

	/**
	 * Return a previously inherited owner UUID when a nested list becomes root.
	 *
	 * @param   {string} clientId Gutenberg client ID for the current block.
	 * @param   {string} name     Block name.
	 * @returns {string}          Adoptable UUID, or empty.
	 */
	function getPromotedListOwnerUuid(clientId, name) {
		if (name !== 'core/list' || isNonOwningNestedListBlock(clientId, name)) {
			return '';
		}

		const ownerUuid = String(SFE.blockEditorListOwnershipRegistry[clientId] || '').trim();
		if (!ownerUuid) {
			return '';
		}

		const registeredClient = getRegisteredClient(ownerUuid);
		if (registeredClient && registeredClient !== clientId) {
			return '';
		}

		return ownerUuid;
	}

	/**
	 * Generate a UUID matching the PHP-side format exactly.
	 *
	 * @param   {string} elementCode Handler element type code.
	 * @returns {string}             Fresh UUID.
	 */
	function generateStrictUuid(elementCode) {
		const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
		let random  = '';
		for (let i = 0; i < 16; i++) {
			random += chars.charAt(Math.floor(Math.random() * 62));
		}
		return currentPostId + '-' + elementCode + '-' + random;
	}

	/**
	 * Return whether one schema-declared block is Gutenberg's unmodified default
	 * block and must remain transient until the author changes it.
	 *
	 * Gutenberg reuses its unmodified default block as the bottom-of-canvas
	 * writing surface. Adding a persisted UUID attribute makes that block real
	 * content, causing the editor to create another default block below it on
	 * every subsequent click. The eligible block type comes from its PHP schema;
	 * Gutenberg's generic predicate determines its current state.
	 *
	 * @param   {Object} block Candidate editor block.
	 * @returns {boolean} True when UUID assignment must wait for a real edit.
	 */
	function shouldDeferDefaultBlockUuidAssignment(block) {
		const attrs = block?.attributes || {};

		return (
			Object.prototype.hasOwnProperty.call(pristineDefaultBlocks, block?.name) &&
			!String(attrs.mwpSfeUuid || '').trim() &&
			!String(attrs.mwpSfeUuidShadow || '').trim() &&
			wp.blocks.isUnmodifiedDefaultBlock(block)
		);
	}

	/**
	 * Queue one attribute update only when the target values actually change.
	 *
	 * @param {Object} pendingUpdates Accumulator keyed by client ID.
	 * @param {Object} block          Current block object.
	 * @param {Object} patch          Partial attrs to apply.
	 * @returns {void}
	 */
	function queueAttributeUpdate(pendingUpdates, block, patch) {
		if (!block?.clientId || !patch || typeof patch !== 'object') {
			return;
		}

		const attrs = block.attributes || {};
		const next  = pendingUpdates[block.clientId] ? { ...pendingUpdates[block.clientId] } : {};
		let changed = false;

		Object.keys(patch).forEach(key => {
			if (attrs[key] !== patch[key] || next[key] !== patch[key]) {
				next[key] = patch[key];
				changed   = true;
			}
		});

		if (changed) {
			pendingUpdates[block.clientId] = next;
		}
	}

	/**
	 * Apply queued block-attribute updates through the editor store.
	 *
	 * @param   {Object} pendingUpdates Attr patches keyed by client ID.
	 * @returns {boolean}               True when any update was dispatched.
	 */
	function applyPendingUpdates(pendingUpdates) {
		const clientIds = Object.keys(pendingUpdates);
		if (!clientIds.length || !wp?.data?.dispatch) {
			return false;
		}

		const dispatcher = wp.data.dispatch('core/block-editor');
		if (!dispatcher || typeof dispatcher.updateBlockAttributes !== 'function') {
			return false;
		}

		clientIds.forEach(clientId => {
			// UUID repair must not create its own undo level. The duplicate action
			// should be the only persistent history entry; otherwise undo restores
			// stale duplicate UUIDs and this reconciler keeps generating new ones.
			if (typeof dispatcher.__unstableMarkNextChangeAsNotPersistent === 'function') {
				dispatcher.__unstableMarkNextChangeAsNotPersistent();
			}
			dispatcher.updateBlockAttributes(clientId, pendingUpdates[clientId]);
		});

		return true;
	}

	/**
	 * Reconcile one block and its descendants against the canonical UUID rules.
	 *
	 * @param   {Object} block                                  Gutenberg block object.
	 * @param   {Object} context                                Traversal context.
	 * @param   {Object} context.pendingUpdates                 Pending attr patches keyed by client ID.
	 * @param   {Object} context.seenUuids                      UUIDs already claimed in this pass.
	 * @param   {Object} context.nextUuidRegistry               Registry snapshot being rebuilt.
	 * @param   {Object} context.nextListOwnerRegistry          List-owner snapshot being rebuilt.
	 * @param   {string} context.inheritedListOwnerUuid         Canonical root-list UUID for descendants.
	 * @returns {string}                                        Final UUID that descendants should inherit.
	 */
	function reconcileBlockTreeNode(block, context) {
		if (!block || !block.clientId || !block.name) {
			return context.inheritedListOwnerUuid || '';
		}

		const {
			pendingUpdates,
			seenUuids,
			nextUuidRegistry,
			nextListOwnerRegistry,
			inheritedListOwnerUuid
		} = context;
		const attrs          = block.attributes || {};
		const currentUuid    = typeof attrs.mwpSfeUuid === 'string' ? attrs.mwpSfeUuid.trim() : '';
		const shadowUuid     = typeof attrs.mwpSfeUuidShadow === 'string' ? attrs.mwpSfeUuidShadow.trim() : '';
		const isSupported    = supportedBlocks.includes(block.name);

		let resolvedListOwnerUuid = inheritedListOwnerUuid || '';

		if (!isSupported) {
			(block.innerBlocks || []).forEach(innerBlock => {
				reconcileBlockTreeNode(innerBlock, {
					pendingUpdates,
					seenUuids,
					nextUuidRegistry,
					nextListOwnerRegistry,
					inheritedListOwnerUuid: resolvedListOwnerUuid
				});
			});

			return resolvedListOwnerUuid;
		}

		const elementCode    = supportedMap[block.name];
		const expectedPrefix = currentPostId + '-' + elementCode + '-';
		const deferDefaultBlockUuidAssignment = shouldDeferDefaultBlockUuidAssignment(block);

		let effectiveUuid       = currentUuid;
		let effectiveShadowUuid = shadowUuid;

		if (isNonOwningNestedListBlock(block.clientId, block.name)) {
			const inheritedOwner = resolvedListOwnerUuid || getInheritedListOwnerUuid(block.clientId);
			if (inheritedOwner) {
				rememberListOwner(block.clientId, inheritedOwner);
				nextListOwnerRegistry[block.clientId] = inheritedOwner;
			}

			if (currentUuid || shadowUuid) {
				queueAttributeUpdate(pendingUpdates, block, {
					mwpSfeUuid:       '',
					mwpSfeUuidShadow: ''
				});
			}

			(block.innerBlocks || []).forEach(innerBlock => {
				reconcileBlockTreeNode(innerBlock, {
					pendingUpdates,
					seenUuids,
					nextUuidRegistry,
					nextListOwnerRegistry,
					inheritedListOwnerUuid: inheritedOwner
				});
			});

			return inheritedOwner;
		}

		const promotedListOwnerUuid = getPromotedListOwnerUuid(block.clientId, block.name);

		if (!effectiveUuid && !effectiveShadowUuid && promotedListOwnerUuid) {
			effectiveUuid       = promotedListOwnerUuid;
			effectiveShadowUuid = promotedListOwnerUuid;
		} else if (!effectiveUuid && !effectiveShadowUuid && !deferDefaultBlockUuidAssignment) {
			effectiveUuid       = generateStrictUuid(elementCode);
			effectiveShadowUuid = effectiveUuid;
		} else if (!effectiveUuid && effectiveShadowUuid) {
			effectiveUuid = effectiveShadowUuid;
		}

		if (effectiveUuid && !effectiveUuid.startsWith(expectedPrefix)) {
			releaseUuidOwnership(effectiveUuid, block.clientId);
			effectiveUuid       = generateStrictUuid(elementCode);
			effectiveShadowUuid = effectiveUuid;
		}

		const existingOwnerClientId = effectiveUuid ? (seenUuids[effectiveUuid] || '') : '';
		if (effectiveUuid && existingOwnerClientId && existingOwnerClientId !== block.clientId) {
			effectiveUuid       = generateStrictUuid(elementCode);
			effectiveShadowUuid = effectiveUuid;
		}

		if (effectiveUuid && effectiveShadowUuid !== effectiveUuid) {
			effectiveShadowUuid = effectiveUuid;
		}

		if (effectiveUuid) {
			seenUuids[effectiveUuid]        = block.clientId;
			nextUuidRegistry[effectiveUuid] = block.clientId;
			if (block.name === 'core/list') {
				resolvedListOwnerUuid = effectiveUuid;
			}
		}

		if (block.name === 'core/list' && resolvedListOwnerUuid) {
			rememberListOwner(block.clientId, resolvedListOwnerUuid);
			nextListOwnerRegistry[block.clientId] = resolvedListOwnerUuid;
		}

		if (effectiveUuid !== currentUuid || effectiveShadowUuid !== shadowUuid) {
			queueAttributeUpdate(pendingUpdates, block, {
				mwpSfeUuid:       effectiveUuid,
				mwpSfeUuidShadow: effectiveShadowUuid
			});
		}

		(block.innerBlocks || []).forEach(innerBlock => {
			reconcileBlockTreeNode(innerBlock, {
				pendingUpdates,
				seenUuids,
				nextUuidRegistry,
				nextListOwnerRegistry,
				inheritedListOwnerUuid: resolvedListOwnerUuid
			});
		});

		return resolvedListOwnerUuid;
	}

	/**
	 * Rebuild UUID ownership from the live editor tree and repair invalid attrs.
	 *
	 * @returns {boolean} True when any block attrs were updated.
	 */
	function reconcileEditorBlockTree() {
		const blocks = getEditorBlocks();
		if (!blocks.length) {
			SFE.blockEditorUuidRegistry = {};
			SFE.blockEditorListOwnershipRegistry = {};
			return false;
		}

		const pendingUpdates        = {};
		const seenUuids             = {};
		const nextUuidRegistry      = {};
		const nextListOwnerRegistry = {};

		blocks.forEach(block => {
			reconcileBlockTreeNode(block, {
				pendingUpdates,
				seenUuids,
				nextUuidRegistry,
				nextListOwnerRegistry,
				inheritedListOwnerUuid: ''
			});
		});

		SFE.blockEditorUuidRegistry          = nextUuidRegistry;
		SFE.blockEditorListOwnershipRegistry = nextListOwnerRegistry;

		return applyPendingUpdates(pendingUpdates);
	}

	/**
	 * Build one lightweight signature for UUID-relevant editor state.
	 *
	 * @param   {Array}  blocks Top-level editor blocks.
	 * @returns {string}        Stable signature string.
	 */
	function buildUuidStateSignature(blocks) {
		const parts = [];

		(function walk(nodes) {
			(nodes || []).forEach(block => {
				if (!block?.clientId || !block?.name) {
					return;
				}

				const attrs = block.attributes || {};
				parts.push([
					block.clientId,
					block.name,
					attrs.mwpSfeUuid || '',
					attrs.mwpSfeUuidShadow || '',
					shouldDeferDefaultBlockUuidAssignment(block) ? 'deferred-default' : ''
				].join('|'));

				if (block.innerBlocks?.length) {
					walk(block.innerBlocks);
				}
			});
		})(blocks);

		return parts.join('||');
	}

	/**
	 * Start one shared store subscriber for UUID reconciliation.
	 *
	 * @returns {void}
	 */
	function bootUuidReconciler() {
		if (!wp?.data?.subscribe) {
			return;
		}

		let isReconciling         = false;
		let isReconcileScheduled  = false;
		let lastObservedSignature = '';

		/**
		 * Execute one reconciliation pass against the live editor tree.
		 *
		 * @returns {void}
		 */
		function runReconcile() {
			if (isReconciling) {
				return;
			}

			isReconciling = true;
			try {
				reconcileEditorBlockTree();
				lastObservedSignature = buildUuidStateSignature(getEditorBlocks());
			} finally {
				isReconciling = false;
			}
		}

		/**
		 * Coalesce rapid store changes into one scheduled reconciliation pass.
		 *
		 * @returns {void}
		 */
		function scheduleReconcile() {
			if (isReconcileScheduled) {
				return;
			}

			isReconcileScheduled = true;
			window.setTimeout(() => {
				isReconcileScheduled = false;
				runReconcile();
			}, 0);
		}

		runReconcile();

		wp.data.subscribe(() => {
			if (isReconciling) {
				return;
			}

			const nextSignature = buildUuidStateSignature(getEditorBlocks());
			if (nextSignature === lastObservedSignature) {
				return;
			}

			lastObservedSignature = nextSignature;
			scheduleReconcile();
		});
	}

	bootUuidReconciler();
	SFE.BlockEditorUuid = {
		supportedBlocks,
		reconcileEditorBlockTree
	};

})();
