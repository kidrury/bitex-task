import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [ProductsService],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should normalize pagination query params and include ordering metadata', async () => {
    const spy = jest.spyOn(service, 'findAll').mockResolvedValue([{ id: 'a-1', sku: 'A-1', onHand: 5, reserved: 1, available: 4 }]);

    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnValue([{ id: 'a-1', sku: 'A-1', onHand: 5, reserved: 1, available: 4 }]),
    } as any;

    const result = await controller.findAll(2, 100, response as any);

    expect(spy).toHaveBeenCalledWith({ page: 2, pageSize: 50, orderBy: 'id', direction: 'asc' });
    expect(response.setHeader).toHaveBeenCalledWith('X-Page', 2);
    expect(response.setHeader).toHaveBeenCalledWith('X-Page-Size', 50);
    expect(result).toEqual([{ id: 'a-1', sku: 'A-1', onHand: 5, reserved: 1, available: 4 }]);
  });
});
