export async function generateOrderNumber(prisma: any): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.order.count();
  const seq = String(count + 1001).padStart(4, '0');
  return `SD-${year}-${seq}`;
}
