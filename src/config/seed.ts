import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Seeding Spider Designs database...');

  const adminHash = await bcrypt.hash('Admin@1234', 12);
  await prisma.user.upsert({
    where: { phone: '+233000000000' },
    update: {},
    create: { firstName:'Spider', lastName:'Admin', phone:'+233000000000', email:'admin@spiderdesigns.gh', passwordHash:adminHash, role:'admin', isVerified:true },
  });
  console.log('✓ Admin user created: admin@spiderdesigns.gh / Admin@1234');

  const workerHash = await bcrypt.hash('Worker@1234', 12);
  const workerData = [
    { firstName:'Kofi',    lastName:'Mensah',   phone:'+233244001001', specialties:['Senator Suits','Agbada'] },
    { firstName:'Abena',   lastName:'Osei',     phone:'+233244002002', specialties:['Native Shirts','Custom'] },
    { firstName:'Akosua',  lastName:'Boateng',  phone:'+233244003003', specialties:['Casual','Ankara'] },
    { firstName:'Yaw',     lastName:'Darko',    phone:'+233244004004', specialties:['Ready-Made','Alterations'] },
    { firstName:'Efua',    lastName:'Asante',   phone:'+233244005005', specialties:['Embroidery'] },
  ];

  for (const w of workerData) {
    const user = await prisma.user.upsert({
      where: { phone: w.phone }, update: {},
      create: { ...w, passwordHash:workerHash, role:'worker', isVerified:true },
    });
    await prisma.worker.upsert({
      where: { userId: user.id }, update: {},
      create: { userId:user.id, specialties:w.specialties, maxCapacity:5 },
    });
  }
  console.log('✓ Workers seeded');

  const cats = [
    { name:'Senator Suits', slug:'senator', sortOrder:1 },
    { name:'Agbada / Boubou', slug:'agbada', sortOrder:2 },
    { name:'Native Shirts', slug:'native', sortOrder:3 },
    { name:'Casual Wear', slug:'casual', sortOrder:4 },
    { name:'Kaftan', slug:'kaftan', sortOrder:5 },
    { name:'Corporate', slug:'corporate', sortOrder:6 },
  ];
  for (const cat of cats) {
    await prisma.category.upsert({ where:{ slug:cat.slug }, update:{}, create:cat });
  }
  console.log('✓ Categories seeded');

  const settingsData = [
    { key:'shop_name',             value:'Spider Clothing & Designs' },
    { key:'shop_phone',            value:'+233244000000' },
    { key:'shop_email',            value:'hello@spiderdesigns.gh' },
    { key:'shop_address',          value:'Osu, Accra, Ghana' },
    { key:'express_surcharge_pct', value:'30' },
    { key:'rush_surcharge_pct',    value:'60' },
    { key:'delivery_fee_accra',    value:'50' },
    { key:'delivery_fee_outside',  value:'100' },
    { key:'deposit_percentage',    value:'50' },
    { key:'embroidery_simple',     value:'80' },
    { key:'embroidery_full',       value:'180' },
    { key:'currency',              value:'GHS' },
    { key:'order_number_prefix',   value:'SD' },
  ];
  for (const s of settingsData) {
    await prisma.setting.upsert({ where:{ key:s.key }, update:{ value:s.value }, create:s });
  }
  console.log('✓ Settings seeded');

  console.log('\n✅ Seeding complete!');
  console.log('   Admin:  admin@spiderdesigns.gh / Admin@1234');
  console.log('   Worker passwords: Worker@1234');
  await prisma.$disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
