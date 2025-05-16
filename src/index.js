import { jwtDecode } from 'jwt-decode'; 

if (typeof window !== 'undefined') {
    window.jwtDecodeGlobal = jwtDecode; 
}



// // Re-export everything from the scte35 package
// import * as scte35 from 'scte35';

// // Attach to window (optional for Chrome extension)
// if (typeof window !== 'undefined') {
//     window.SCTE35 = scte35;
// }

// // Export for bundlers
// export default scte35;
