import { ReservationDTO } from "src/reservations/DTO/reservation.dto";


export const normalizeItems = (items: ReservationDTO): string => {
    const entries: string[] = items.items
        .map((item) => `${item.productId}:${item.quantity}`)
        .sort((left, right) => left.localeCompare(right));

    const normalizedString = entries.join("|");
    return normalizedString;
}

export const sortItemsForLocking = (items: {
        productId: string;
        quantity: number;
    }[]) => [...items].sort((a, b) => a.productId.localeCompare(b.productId))