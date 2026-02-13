import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  return {
    /** Token address from the URL, or null if on the map root */
    address: params.address || null
  };
};
