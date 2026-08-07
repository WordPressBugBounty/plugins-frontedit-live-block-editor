/**
 * Block Comparison - UUID-normalized equivalence checks for serialized block strings.
 *
 *   FAST PATH  – direct string equality on the raw serialized blocks.
 *                No parse overhead; catches the common "nothing changed" case.
 *
 *   SLOW PATH  – parse, strip UUID attrs, re-serialize, then compare.
 *                Catches cases where only UUID attribute ordering or values
 *                differ between the stored baseline and the current version,
 *                preventing false-positive "changed" signals.
 *
 * normalizeBlockOwn() mirrors PHP normalize_block_own(): it strips UUID attrs
 * and, for container blocks, removes inner block content so that edits to
 * children don't falsely mark the container as changed.  Used by the
 * block-editor save path where each block is compared independently.
 *
 * normalizeRaw() mirrors PHP normalize_block_for_comparison(): full-tree
 * normalization (UUID attrs stripped, inner blocks preserved).  Used by the
 * frontend batch-edit path where the whole edited block including inner blocks
 * is sent as the payload.
 *
 * Reads (via globals):
 *   window.wp.blocks  – .parse, .serialize  (always present on frontend)
 *
 * Exposes: SFE.BlockComparison
 *   { normalizeRaw, normalizeBlockOwn, blocksAreEquivalent, blockOwnChanged }
 */

(function() {
	'use strict';

	window.MWP      = window.MWP || {};
	window.MWP.SFE  = window.MWP.SFE || {};
	const SFE       = window.MWP.SFE;
	SFE.ManagerData = SFE.ManagerData || {};

	const UUID_ATTRS = ['mwpSfeUuid', 'mwpSfeUuidShadow'];

	// ── Helpers ──────────────────────────────────────────────────────────────

	/**
	 * Recursively strip UUID tracking attributes from a parsed block and all
	 * of its innerBlocks so they don't affect comparisons.
	 *
	 * Returns a new block object; the original is never mutated.
	 *
	 * @param  {Object} block  A block object from wp.blocks.parse().
	 * @return {Object}        New block object with UUID attrs removed.
	 */
	function stripUuidAttrs(block) {
		const attributes = Object.assign({}, block.attributes || {});
		UUID_ATTRS.forEach(k => delete attributes[k]);

		return Object.assign({}, block, {
			attributes,
			innerBlocks: (block.innerBlocks || []).map(stripUuidAttrs)
		});
	}

	/**
	 * Strip UUID attrs from a block and, if it has inner blocks, remove them
	 * (and their placeholder slots in innerContent) so that only the
	 * container's own shell remains.
	 *
	 * Mirrors PHP normalize_block_own().
	 *
	 * @param  {Object} block  A block object from wp.blocks.parse().
	 * @return {Object}        Stripped copy representing only the block's own content.
	 */
	function stripToBlockOwn(block) {
		const attributes = Object.assign({}, block.attributes || {});
		UUID_ATTRS.forEach(k => delete attributes[k]);

		if (!block.innerBlocks || block.innerBlocks.length === 0) {
			// Leaf block - return with only UUID attrs removed.
			return Object.assign({}, block, { attributes });
		}

		// Container: drop inner blocks and collapse null innerContent slots.
		const innerContent = (block.innerContent || []).filter(part => part !== null);

		return Object.assign({}, block, {
			attributes,
			innerBlocks: [],
			innerContent,
		});
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Parse rawContent, strip UUID attrs from every block in the tree, and
	 * re-serialize.  Full-tree normalization used by the frontend batch-edit
	 * path (where the whole edited block including inner blocks is the payload).
	 *
	 * Mirrors PHP normalize_block_for_comparison().
	 *
	 * Returns rawContent unchanged if wp.blocks is unavailable or parsing
	 * fails, so callers always get something comparable.
	 *
	 * @param  {string} rawContent  Serialized WP block markup.
	 * @return {string}
	 */
	function normalizeRaw(rawContent) {
		if (!rawContent) return '';
		if (!window.wp?.blocks?.parse || !window.wp?.blocks?.serialize) {
			return rawContent;
		}
		try {
			const blocks = window.wp.blocks.parse(rawContent);
			if (!blocks || !blocks.length) return rawContent;
			return window.wp.blocks.serialize(blocks.map(stripUuidAttrs));
		} catch (e) {
			// Parse failures are non-fatal; fall back to raw string.
			return rawContent;
		}
	}

	/**
	 * Parse rawContent, strip UUID attrs and inner block slots from the first
	 * (top-level) block, then re-serialize its shell.
	 *
	 * Used by the block-editor save path: each block is compared
	 * independently, so container changes caused only by inner-block edits
	 * should not mark the container itself as changed.
	 *
	 * Mirrors PHP normalize_block_own().
	 *
	 * @param  {string} rawContent  Serialized WP block markup (one block).
	 * @return {string}
	 */
	function normalizeBlockOwn(rawContent) {
		if (!rawContent) return '';
		if (!window.wp?.blocks?.parse || !window.wp?.blocks?.serialize) {
			return rawContent;
		}
		try {
			const blocks = window.wp.blocks.parse(rawContent);
			if (!blocks || !blocks.length) return rawContent;
			return window.wp.blocks.serialize([stripToBlockOwn(blocks[0])]);
		} catch (e) {
			return rawContent;
		}
	}

	/**
	 * Return true when two serialized block strings represent the same content
	 * after full-tree UUID-attr stripping (batch-edit path).
	 *
	 * Uses a fast exact-match short-circuit before the more expensive
	 * parse-normalize-serialize round-trip.
	 *
	 * @param  {string} rawA
	 * @param  {string} rawB
	 * @return {boolean}
	 */
	function blocksAreEquivalent(rawA, rawB) {
		// Fast path.
		if (rawA === rawB) return true;
		if (!rawA || !rawB) return false;
		// Slow path.
		try {
			return normalizeRaw(rawA) === normalizeRaw(rawB);
		} catch (e) {
			return false;
		}
	}

	/**
	 * Return true when a block's own shell has changed compared to a baseline,
	 * ignoring UUID attr differences and inner-block edits (block-editor path).
	 *
	 * Uses a fast exact-match short-circuit before the more expensive
	 * per-block own normalization.
	 *
	 * @param  {string} currentRaw   Current serialized block markup.
	 * @param  {string} baselineRaw  Previously stored serialized block markup.
	 * @return {boolean}  true = block's own content changed; false = no change.
	 */
	function blockOwnChanged(currentRaw, baselineRaw) {
		// Fast path.
		if (currentRaw === baselineRaw) return false;
		if (!currentRaw || !baselineRaw) return currentRaw !== baselineRaw;
		// Slow path.
		try {
			return normalizeBlockOwn(currentRaw) !== normalizeBlockOwn(baselineRaw);
		} catch (e) {
			// Normalization failures are non-fatal; assume changed so we don't
			// silently drop real edits.
			return true;
		}
	}

	SFE.BlockComparison = {
		normalizeRaw,
		normalizeBlockOwn,
		blocksAreEquivalent,
		blockOwnChanged,
	};

})();