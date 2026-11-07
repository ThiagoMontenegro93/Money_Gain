import { useWindowDimensions } from 'react-native';
import { BREAKPOINT_DESKTOP } from '../theme';

export function useLayout() {
  const { width } = useWindowDimensions();
  return { width, isDesktop: width >= BREAKPOINT_DESKTOP, isWide: width >= 1280, isPhone: width < 640 };
}
