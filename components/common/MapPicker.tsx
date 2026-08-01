import React, { useRef, useEffect } from 'react';

// Declare Leaflet type for global L variable from CDN
declare var L: any;

interface MapPickerProps {
    value: { lat: number; lng: number } | null;
    onChange: (location: { lat: number; lng: number }) => void;
}

const MapPicker: React.FC<MapPickerProps> = ({ value, onChange }) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const markerRef = useRef<any>(null);

    const handleSetCurrentLocation = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude } = position.coords;
                    const newLocation = { lat: latitude, lng: longitude };
                    onChange(newLocation);
                    if (mapInstanceRef.current) {
                        mapInstanceRef.current.setView(newLocation, 15);
                    }
                },
                (error) => {
                    alert(`Error getting location: ${error.message}`);
                }
            );
        } else {
            alert('Geolocation is not supported by this browser.');
        }
    };

    useEffect(() => {
        if (mapContainerRef.current && !mapInstanceRef.current) {
            const initialView: [number, number] = value ? [value.lat, value.lng] : [-6.2088, 106.8456]; // Jakarta default
            const initialZoom = value ? 15 : 13;

            const map = L.map(mapContainerRef.current).setView(initialView, initialZoom);
            L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{
                maxZoom: 20,
                subdomains:['mt0','mt1','mt2','mt3'],
                attribution: 'Map data &copy; <a href="https://www.google.com/maps">Google Maps</a>'
            }).addTo(map);
            mapInstanceRef.current = map;

            if (value) {
                markerRef.current = L.marker([value.lat, value.lng]).addTo(map);
            }

            map.on('click', (e: any) => {
                const { lat, lng } = e.latlng;
                onChange({ lat, lng });
            });
        }
    }, []); // Run only once on mount

    useEffect(() => {
        const map = mapInstanceRef.current;
        if (map && value) {
            if (markerRef.current) {
                markerRef.current.setLatLng([value.lat, value.lng]);
            } else {
                markerRef.current = L.marker([value.lat, value.lng]).addTo(map);
            }
            // Only pan if the map view is far from the new value
            if (!map.getBounds().contains(value)) {
                 map.panTo([value.lat, value.lng]);
            }
        } else if (map && !value && markerRef.current) {
            // If location is cleared, remove the marker
            map.removeLayer(markerRef.current);
            markerRef.current = null;
        }
    }, [value]);

    return (
        <div className="relative">
            <div ref={mapContainerRef} className="h-64 rounded-lg z-0"></div>
            <button
                type="button"
                onClick={handleSetCurrentLocation}
                className="absolute top-2 right-2 z-[400] bg-white p-2 rounded-md shadow-lg text-gray-700 hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="My Location"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path fillRule="evenodd" d="M.458 10C.458 4.737 4.737.458 10 .458c5.263 0 9.542 4.279 9.542 9.542s-4.279 9.542-9.542 9.542C4.737 19.542.458 15.263.458 10zM10 2a8 8 0 100 16A8 8 0 0010 2z" clipRule="evenodd" />
                </svg>
            </button>
        </div>
    );
};

export default MapPicker;