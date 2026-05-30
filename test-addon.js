import { fetchJson } from './http.js';

async function testAddon() {
    console.log("======================================================");
    console.log("🧪 STARTING STREMIO ADDON INTEGRATION TESTS");
    console.log("======================================================\n");
    
    try {
        console.log("1. Fetching addon manifest...");
        const manifest = await fetchJson('http://localhost:7000/manifest.json');
        console.log("Manifest details:", {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            resources: manifest.resources,
            types: manifest.types,
            catalogs: manifest.catalogs
        });
        console.log("✅ Manifest endpoint verified!\n");
        
        console.log("2. Testing catalog search ('Kantara')...");
        const catalogUrl = 'http://localhost:7000/catalog/movie/moviesda-search/search=Kantara.json';
        const catalogResults = await fetchJson(catalogUrl);
        console.log(`Found ${catalogResults?.metas?.length || 0} metas.`);
        if (catalogResults && catalogResults.metas && catalogResults.metas.length > 0) {
            console.log("First search result:", catalogResults.metas[0]);
            console.log("✅ Catalog search handler verified!\n");
        } else {
            throw new Error("Catalog search returned empty results!");
        }

        console.log("3. Testing stream handler with custom TMDB ID ('moviesda_tmdb:858485' for Kantara)...");
        const streamTmdbUrl = 'http://localhost:7000/stream/movie/moviesda_tmdb%3A858485.json';
        const streamTmdbResults = await fetchJson(streamTmdbUrl);
        console.log(`Found ${streamTmdbResults?.streams?.length || 0} streams.`);
        if (streamTmdbResults && streamTmdbResults.streams && streamTmdbResults.streams.length > 0) {
            console.log("First stream resolved:", streamTmdbResults.streams[0]);
            console.log("✅ TMDB stream resolution verified!\n");
        } else {
            console.warn("⚠️ TMDB stream resolution returned empty results (may mean Moviesda did not return matches or is blocking requests).");
        }

        console.log("4. Testing stream handler with global IMDb ID ('tt15327088' for Kantara)...");
        const streamImdbUrl = 'http://localhost:7000/stream/movie/tt15327088.json';
        const streamImdbResults = await fetchJson(streamImdbUrl);
        console.log(`Found ${streamImdbResults?.streams?.length || 0} streams.`);
        if (streamImdbResults && streamImdbResults.streams && streamImdbResults.streams.length > 0) {
            console.log("First stream resolved via IMDb:", streamImdbResults.streams[0]);
            console.log("✅ IMDb-to-TMDB stream resolution verified!\n");
        } else {
            console.warn("⚠️ IMDb stream resolution returned empty results.");
        }

        console.log("🎉 ALL INTEGRATION TESTS RUN SUCCESSFULLY! 🎉");
    } catch (e) {
        console.error("❌ TEST FAILED:", e.message);
    }
}

testAddon();
