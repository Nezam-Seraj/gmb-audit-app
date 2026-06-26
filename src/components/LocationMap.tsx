import React from 'react';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';

interface LocationMapProps {
  businessName: string;
  location?: { lat: number, lng: number };
  apiKey?: string;
}

export function LocationMap({ businessName, location, apiKey: propApiKey }: LocationMapProps) {
  const apiKey = propApiKey || process.env.GOOGLE_MAPS_PLATFORM_KEY;

  if (!apiKey) {
    return (
      <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-slate-500">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="text-sm font-medium">Map disabled</p>
        <p className="text-xs text-slate-400 mt-1 max-w-[250px]">
          Enter your API key using the Settings dialog (or wait for the environment variable prompt) to view the live location map.
        </p>
      </div>
    );
  }

  // Sanitize cached location objects that might have used { latitude, longitude } initially.
  let sanitizedLocation = location;
  if (location && typeof (location as any).latitude === 'number' && typeof (location as any).longitude === 'number') {
    sanitizedLocation = { lat: (location as any).latitude, lng: (location as any).longitude };
  } else if (location && (typeof location.lat !== 'number' || typeof location.lng !== 'number')) {
    sanitizedLocation = undefined;
  }

  // Default coordinate if not provided (e.g., center of US or a dummy coordinate)
  const mapCenter = sanitizedLocation || { lat: 39.8283, lng: -98.5795 };
  const mapZoom = sanitizedLocation ? 15 : 4;

  return (
    <div className="w-full h-[300px] rounded-xl overflow-hidden shadow-sm border border-slate-200">
      <APIProvider apiKey={apiKey}>
        <GoogleMap
          defaultCenter={mapCenter}
          defaultZoom={mapZoom}
          mapId="e8a1d7c3bb83b27b"
          options={{
            disableDefaultUI: true,
            zoomControl: true,
            internalUsageAttributionIds: ["gmp_mcp_codeassist_v1_aistudio"]
          }}
        >
          {sanitizedLocation && (
            <AdvancedMarker position={sanitizedLocation} title={businessName}>
              <Pin background="#0f766e" borderColor="#0b5e58" glyphColor="#ffffff" />
            </AdvancedMarker>
          )}
        </GoogleMap>
      </APIProvider>
    </div>
  );
}
