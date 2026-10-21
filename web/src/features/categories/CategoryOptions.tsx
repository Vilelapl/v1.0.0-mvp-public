import type { CategoryDto } from '../../api/dtos';

export function CategoryOptions({ categories, filter = false }: { categories: CategoryDto[]; filter?: boolean }) {
  return <>
    <option value="">{filter ? 'Todas las categorías' : 'Sin categoría'}</option>
    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
  </>;
}
