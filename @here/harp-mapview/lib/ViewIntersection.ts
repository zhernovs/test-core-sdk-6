/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    GeoBox,
    OrientedBox3,
    Projection,
    ProjectionType,
    TileKey,
    TilingScheme,
    GeoCoordinates
} from "@here/harp-geoutils";
import { assert } from "@here/harp-utils";
import * as THREE from "three";
import { DataSource } from "./DataSource";
import { CalculationStatus, ElevationRangeSource } from "./ElevationRangeSource";
import { TileKeyEntry } from "./FrustumIntersection";
import { MapTileCuller } from "./MapTileCuller";
import { MapView } from "./MapView";
import { TileOffsetUtils } from "./Utils";

const tmpVectors3 = [new THREE.Vector3(), new THREE.Vector3()];
const tmpVector4 = new THREE.Vector4();
const MaxError = 1E-7;

function getGeoBox(tilingScheme: TilingScheme, childTileKey: TileKey, offset: number): GeoBox {
    const geoBox = tilingScheme.getGeoBox(childTileKey);
    const longitudeOffset = 360.0 * offset;
    geoBox.northEast.longitude += longitudeOffset;
    geoBox.southWest.longitude += longitudeOffset;
    return geoBox;
}

function geoBoxesIntersect(geoBoxA: GeoBox, geoBoxB: GeoBox): boolean {
    return (
        geoBoxA.west < geoBoxB.east - MaxError &&
        geoBoxA.east >= geoBoxB.west + MaxError &&
        geoBoxA.south <= geoBoxB.north - MaxError &&
        geoBoxA.north >= geoBoxB.south + MaxError
    );
}

/**
 * Map tile keys to TileKeyEntry.
 * Keys are a combination of morton code and tile offset,
 * see [[TileOffsetUtils.getKeyForTileKeyAndOffset]].
 */
type TileKeyEntries = Map<number, TileKeyEntry>;

/**
 * Map zoom level to map of visible tile key entries
 */
type ZoomLevelTileKeyMap = Map<number, TileKeyEntries>;

/**
 * Result of frustum intersection
 */
interface IntersectionResult {
    /**
     * Tiles intersected by the frustum per zoom level.
     */
    readonly tileKeyEntries: ZoomLevelTileKeyMap;

    /**
     * True if the intersection was calculated using precise elevation data, false if it's an
     * approximation.
     */
    calculationFinal: boolean;
}

/**
 * Computes the tiles intersected by the frustum defined by the current camera setup.
 */
export class ViewIntersection {
    // used to project global coordinates into camera local coordinates
    private readonly m_viewProjectionMatrix = new THREE.Matrix4();
    private m_rootTileKeys: TileKeyEntry[] = [];
    private readonly m_tileKeyEntries: ZoomLevelTileKeyMap = new Map();
    private m_worldBox: GeoBox | undefined;

    constructor(
        private readonly m_camera: THREE.OrthographicCamera,
        readonly mapView: MapView,
        private readonly m_tileWrappingEnabled: boolean,
        private readonly m_enableMixedLod: boolean
    ) {
        // const worldCenterPoint = this.mapView.projection.unprojectPoint(mapView.camera.position);
    }

    /**
     * Return camera used for generating frustum.
     */
    get camera(): THREE.OrthographicCamera {
        return this.m_camera;
    }

    /**
     * Return projection used to convert geo coordinates to world coordinates.
     */
    get projection(): Projection {
        return this.mapView.projection;
    }

    /**
     * Updates the frustum to match the current camera setup.
     */
    updateFrustum(projectionMatrixOverride?: THREE.Matrix4) {
        this.m_viewProjectionMatrix.multiplyMatrices(
            projectionMatrixOverride !== undefined
                ? projectionMatrixOverride
                : this.m_camera.projectionMatrix,
            this.m_camera.matrixWorldInverse
        );

        if (this.mapView.geoBox === undefined) {
            this.m_worldBox = new GeoBox(new GeoCoordinates(0, 0, 0), new GeoCoordinates(0, 0, 0));
        } else {
            this.m_worldBox = this.mapView.geoBox;
        }

        this.computeRequiredInitialRootTileKeys(this.m_camera.position);
    }

    /**
     * Computes the tiles intersected by the updated frustum, see [[updateFrustum]].
     *
     * @param tilingScheme The tiling scheme used to generate the tiles.
     * @param elevationRangeSource Source of elevation range data if any.
     * @param zoomLevels A list of zoom levels to render.
     * @param dataSources A list of data sources to render.
     * @returns The computation result, see [[FrustumIntersection.Result]].
     */
    compute(
        tilingScheme: TilingScheme,
        elevationRangeSource: ElevationRangeSource | undefined,
        zoomLevels: number[],
        dataSources: DataSource[]
    ): IntersectionResult {
        this.m_tileKeyEntries.clear();

        if (this.m_worldBox === undefined) {
            return { tileKeyEntries: this.m_tileKeyEntries, calculationFinal: true };
        }

        let calculationFinal = true;

        // Compute target tile area in clip space size.
        // A tile should take up roughly 256x256 pixels on screen in accordance to
        // the zoom level chosen by [MapViewUtils.calculateZoomLevelFromDistance].
        assert(this.mapView.viewportHeight !== 0);
        const targetTileArea = Math.pow(256 / this.mapView.viewportHeight, 2);
        const useElevationRangeSource: boolean =
            elevationRangeSource !== undefined &&
            elevationRangeSource.getTilingScheme() === tilingScheme;
        const obbIntersections =
            this.mapView.projection.type === ProjectionType.Spherical || useElevationRangeSource;
        const tileBounds = obbIntersections ? new OrientedBox3() : new THREE.Box3();
        const uniqueZoomLevels = new Set(zoomLevels);

        // create tile key map per zoom level
        for (const zoomLevel of uniqueZoomLevels) {
            this.m_tileKeyEntries.set(zoomLevel, new Map());
        }
        for (const item of this.m_rootTileKeys) {
            const tileKeyEntry = new TileKeyEntry(
                item.tileKey,
                Infinity,
                item.offset,
                item.minElevation,
                item.maxElevation
            );
            for (const zoomLevel of uniqueZoomLevels) {
                const tileKeyEntries = this.m_tileKeyEntries.get(zoomLevel)!;
                tileKeyEntries.set(
                    TileOffsetUtils.getKeyForTileKeyAndOffset(item.tileKey, item.offset),
                    tileKeyEntry
                );
            }
        }

        const workList = [...this.m_rootTileKeys.values()];
        while (workList.length > 0) {
            const tileEntry = workList.pop();

            if (tileEntry === undefined) {
                break;
            }

            // Stop subdivision if hightest visible level is reached
            const tileKey = tileEntry.tileKey;
            const subdivide = dataSources.some((ds, i) =>
                ds.shouldSubdivide(zoomLevels[i], tileKey)
            );
            if (!subdivide) {
                continue;
            }

            // Stop subdivision if area of tile is too small(mixed LOD only)
            if (this.m_enableMixedLod && tileEntry.area < targetTileArea) {
                continue;
            }

            const parentTileKey = TileOffsetUtils.getKeyForTileKeyAndOffset(
                tileKey,
                tileEntry.offset
            );

            // delete parent tile key from applicable zoom levels
            for (const zoomLevel of uniqueZoomLevels) {
                if (tileKey.level >= zoomLevel) {
                    continue;
                }

                const tileKeyEntries = this.m_tileKeyEntries.get(zoomLevel)!;
                tileKeyEntries.delete(parentTileKey);
            }

            for (const childTileKey of tilingScheme.getSubTileKeys(tileKey)) {
                const offset = tileEntry.offset;
                const tileKeyAndOffset = TileOffsetUtils.getKeyForTileKeyAndOffset(
                    childTileKey,
                    offset
                );

                const geoBox = getGeoBox(tilingScheme, childTileKey, offset);

                if (!geoBoxesIntersect(this.m_worldBox, geoBox)) {
                    continue;
                }
                const area = 1;
                const distance = 1;

                const subTileEntry = new TileKeyEntry(
                    childTileKey,
                    area,
                    offset,
                    geoBox.southWest.altitude, // minElevation
                    geoBox.northEast.altitude, // maxElevation
                    distance
                );

                // insert sub tile entry into tile entries map per zoom level
                for (const zoomLevel of uniqueZoomLevels) {
                    if (subTileEntry.tileKey.level > zoomLevel) {
                        continue;
                    }

                    const tileKeyEntries = this.m_tileKeyEntries.get(zoomLevel)!;
                    tileKeyEntries.set(tileKeyAndOffset, subTileEntry);
                }

                workList.push(subTileEntry);
            }
        }
        return { tileKeyEntries: this.m_tileKeyEntries, calculationFinal };
    }

    // /**
    //  * Estimate screen space area of tile and distance to center of tile
    //  * @param tileBounds The bounding volume of a tile
    //  * @return Area estimate and distance to tile center in clip space
    //  */
    // private computeTileAreaAndDistance(
    //     tileBounds: THREE.Box3 | OrientedBox3
    // ): { area: number; distance: number } {
    //     if (tileBounds instanceof THREE.Box3) {
    //         if (!this.m_frustum.intersectsBox(tileBounds)) {
    //             return {
    //                 area: 0,
    //                 distance: Infinity
    //             };
    //         }
    //     } else if (!tileBounds.intersects(this.m_frustum)) {
    //         return {
    //             area: 0,
    //             distance: Infinity
    //         };
    //     }

    //     // Project tile bounds center
    //     const center = tileBounds.getCenter(tmpVectors3[0]);
    //     const projectedPoint = tmpVector4
    //         .set(center.x, center.y, center.z, 1.0)
    //         .applyMatrix4(this.m_viewProjectionMatrix);

    //     // Estimate objects screen space size with diagonal of bounds
    //     // Dividing by w projects object size to screen space
    //     const size = tileBounds.getSize(tmpVectors3[1]);
    //     const objectSize = (0.5 * size.length()) / projectedPoint.w;

    //     return {
    //         area: objectSize * objectSize,
    //         distance: projectedPoint.z / projectedPoint.w
    //     };
    // }

    /**
     * Create a list of root nodes to test against the frustum. The root nodes each start at level 0
     * and have an offset (see [[Tile]]) based on:
     * - the current position [[worldCenter]].
     * - the height of the camera above the world.
     * - the field of view of the camera (the maximum value between the horizontal / vertical
     *   values)
     * - the tilt of the camera (because we see more tiles when tilted).
     *
     * @param worldCenter The center of the camera in world space.
     */
    private computeRequiredInitialRootTileKeys(worldCenter: THREE.Vector3) {
        this.m_rootTileKeys = [];
        const rootTileKey = TileKey.fromRowColumnLevel(0, 0, 0);
        const tileWrappingEnabled = this.mapView.projection.type === ProjectionType.Planar;

        if (!tileWrappingEnabled || !this.m_tileWrappingEnabled) {
            this.m_rootTileKeys.push(new TileKeyEntry(rootTileKey, Infinity, 0, 0));
            return;
        }

        // FIXME: compute list of original root tiles
        this.m_rootTileKeys.push(new TileKeyEntry(rootTileKey, Infinity, 0, 0, 0));
    }
}
