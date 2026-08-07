<?php
/**
 * Block manipulation utilities.
 * Provides stateless, static helper methods for traversing and 
 * modifying Gutenberg block arrays based on their UUIDs.
 */

namespace MWPSFE;

if ( ! defined( 'ABSPATH' ) ) exit;

class MWPSFE_Block_Utils {

	/**
	 * Find a block by its UUID
	 * 
	 * Recursively searches through a blocks array to find the block with the specified UUID.
	 * 
	 * Returns the complete block array including:
	 * - blockName, attrs, innerHTML, innerContent, innerBlocks
	 * 
	 * @param array $blocks Array of block arrays to search through
	 * @param string $target_uuid The UUID to search for
	 * @return array|null The matching block array or null if not found
	 */
	public static function find_block_by_uuid( $blocks, $target_uuid ) {
		foreach ( $blocks as $block ) {
			if ( empty( $block['blockName'] ) ) continue;

			$block_uuid = $block['attrs']['mwpSfeUuidShadow'] ?? ( $block['attrs']['mwpSfeUuid'] ?? '' );

			if ( $block_uuid === $target_uuid ) {
				return $block;
			}
			
			if ( ! empty( $block['innerBlocks'] ) ) {
				$found = self::find_block_by_uuid( $block['innerBlocks'], $target_uuid );
				if ( $found ) return $found;
			}
		}
		unset( $block );// Clean up reference
		return null;
	}

	/**
	 * Recursively find a block by UUID in a block tree and replace it.
	 *
	 * @param array  &$blocks     Block tree (modified in place).
	 * @param string $uuid        UUID to locate.
	 * @param array  $replacement Replacement block array.
	 * @return bool  True         if found and replaced.
	 */
	public static function replace_block_by_uuid( array &$blocks, string $uuid, array $replacement ): bool {
		foreach ( $blocks as &$block ) {
			if ( empty( $block['blockName'] ) ) continue;
			
			$block_uuid = $block['attrs']['mwpSfeUuidShadow'] ?? ( $block['attrs']['mwpSfeUuid'] ?? '' );
			
			if ( $block_uuid === $uuid ) {
				$block = $replacement;
				return true;
			}
			
			if ( ! empty( $block['innerBlocks'] ) ) {
				if ( self::replace_block_by_uuid( $block['innerBlocks'], $uuid, $replacement ) ) {
					return true;
				}
			}
		}
		unset( $block );// Clean up reference
		return false;
	}

	/**
	 * Update a block's content by UUID using its handler.
	 * 
	 * This method recursively searches through blocks to find the target UUID and updates it.
	 * 
	 * @param array                     &$blocks        Block tree (modified in place).
	 * @param string                    $target_uuid    The UUID to update.
	 * @param string                    $new_content    New content to inject.
	 * @param MWPSFE_Handler_Interface $handler        The handler responsible for updating.
	 * @param array                     $original_attrs Original attributes to preserve.
	 * @return bool                     True            if block was found and updated.
	 */
	public static function update_block_by_uuid( &$blocks, $target_uuid, $new_content, $handler, $original_attrs = array() ) {
		foreach ( $blocks as &$block ) {
			if ( empty( $block['blockName'] ) ) continue;

			$block_uuid = $block['attrs']['mwpSfeUuidShadow'] ?? ( $block['attrs']['mwpSfeUuid'] ?? '' );

			if ( $block_uuid === $target_uuid ) {
				return $handler->update_block_content( $block, $new_content, $original_attrs );
			}

			if ( ! empty( $block['innerBlocks'] ) ) {
				if ( self::update_block_by_uuid( $block['innerBlocks'], $target_uuid, $new_content, $handler, $original_attrs ) ) {
					return true;
				}
			}
		}
		unset( $block );// Clean up reference
		return false;
	}
}
