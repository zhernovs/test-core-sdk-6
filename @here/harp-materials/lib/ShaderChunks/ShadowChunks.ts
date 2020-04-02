/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

export const correctShadowChunk = `
    struct PhysicalMaterial {
        vec3	diffuseColor;
        float	specularRoughness;
        vec3	specularColor;
    };

    #define DEFAULT_SPECULAR_COEFFICIENT 0.04

    void RE_Direct_Physical( const in IncidentLight directLight,
        const in GeometricContext geometry,
        const in PhysicalMaterial material,
        inout ReflectedLight reflectedLight ) {
        // directLight.color is the light color * shadow, internally three.js uses a step function, so
        // this value is either the light color or black. in order to lighten up the shadows, we
        // subtract 1 from the light color and multiply that with 50% of the diffuse
        // color.
        #if defined(USE_SHADOWMAP)
            reflectedLight.directDiffuse = directLight.color * material.diffuseColor +
            (vec3(1,1,1)-directLight.color) * (0.5) * material.diffuseColor;
        #else
            reflectedLight.directDiffuse = material.diffuseColor;
        #endif
    }

    void RE_IndirectDiffuse_Physical( const in vec3 irradiance,
        const in GeometricContext geometry,
        const in PhysicalMaterial material,
        inout ReflectedLight reflectedLight ) {
            // Kept deliberately empty
    }

    void RE_IndirectSpecular_Physical( const in vec3 radiance,
        const in vec3 irradiance,
        const in vec3 clearcoatRadiance,
        const in GeometricContext geometry,
        const in PhysicalMaterial material,
        inout ReflectedLight reflectedLight) {
            // Kept deliberately empty
    }

    #define RE_Direct               RE_Direct_Physical
    #define RE_IndirectDiffuse      RE_IndirectDiffuse_Physical
    #define RE_IndirectSpecular     RE_IndirectSpecular_Physical
`;
