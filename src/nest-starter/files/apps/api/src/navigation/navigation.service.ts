import { Injectable } from '@nestjs/common';
import { hasPermissions } from '../auth/auth.types';
import { NavigationDto, NavigationItemDto, NavigationItemType } from './navigation.dto';
import { NAVIGATION, NavigationItem } from './navigation.registry';

/** The entries an admin with `granted` permissions may see (`permission` is dropped from the result). */
export function filterNavigation(items: readonly NavigationItem[], granted: readonly string[]): NavigationItemDto[] {
  const result: NavigationItemDto[] = [];
  for (const item of items) {
    const needed = item.permission === undefined ? [] : [item.permission].flat();
    if (!hasPermissions(granted, needed)) continue;
    const children = item.children ? filterNavigation(item.children, granted) : undefined;
    if (item.children && !children?.length) continue;
    result.push({
      id: item.id,
      title: item.title,
      type: children ? NavigationItemType.Collapsable : NavigationItemType.Basic,
      icon: item.icon,
      link: item.link,
      ...(children ? { children } : {}),
    });
  }
  return result;
}

@Injectable()
export class NavigationService {
  /** The Fuse layouts share one tree: the UI fills `children` of the other variants by `id`. */
  get(granted: readonly string[]): NavigationDto {
    const tree = filterNavigation(NAVIGATION, granted);
    return { default: tree, compact: tree, futuristic: tree, horizontal: tree };
  }
}
