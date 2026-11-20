export const CREDIT_NOTE_QUOTATION_SECTIONS = [
  {
    direction: 'IMPORT',
    port: 'DRYPORT',
    columns: ['LCL', '1.5 T', '2.5T', '5T', 'REMARK', ''],
    rows: [
      {
        service: 'CLEARANCE',
        values: ['60', '', '', '', '', ''],
      },
      {
        service: 'Truck',
        values: ['', '15', '25', '50', 'VFL / JYX', 'INCREASE TRUCKING FEE 2$ FOR VFL/JYX'],
      },
      {
        service: 'Truck',
        values: [
          '',
          '35',
          '45',
          '90',
          'For Sportline / JR',
          'INCREASE TRUCKING FEE 5/10/15, 1.5T/2.5T/5T FOR SAK/JR',
        ],
      },
      {
        service: 'Customs Acc',
        values: ['10', '', '', '', '', ''],
      },
      {
        service: 'Customs Processing fee',
        values: ['13.75', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'Storage',
        values: ['', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'PERMIT',
        values: ['35', '35', '35', '35', 'EXPRESS', ''],
      },
    ],
  },
  {
    direction: 'IMPORT',
    port: 'AIRPORT',
    columns: ['LCL', '1.5 T', '2.5T', '5T', 'REMARK', ''],
    rows: [
      {
        service: 'CLEARANCE',
        values: ['75', '', '', '', '', ''],
      },
      {
        service: 'Truck',
        values: ['', '40', '55', '90', 'VFL / JYX', 'INCREASE TRUCKING FEE 5/10/15, 1.5T/2.5T/5T'],
      },
      {
        service: 'Truck',
        values: [
          '',
          '50',
          '65',
          '110',
          'For Sportline / JR',
          'INCREASE TRUCKING FEE 5/10/15, 1.5T/2.5T/5T',
        ],
      },
      {
        service: 'Customs Acc',
        values: ['15', '', '', '', '', ''],
      },
      {
        service: 'Customs Processing fee',
        values: ['13.75', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'PERMIT',
        values: ['35', '35', '35', '35', 'EXPRESS', ''],
      },
    ],
  },
  {
    direction: 'IMPORT',
    port: 'SHV',
    columns: ['LCL', "20'", "40'", 'REMARK', 'REMARK', ''],
    rows: [
      {
        service: 'CLEARANCE',
        values: ['100', '115', '125', '', '', ''],
      },
      {
        service: 'AUG ONWARD INCREASE',
        values: ['95$ (LCL)', '', '', '', '', ''],
      },
      {
        service: 'Truck fee',
        values: ['', '160', '240', '', 'VFL / JYX ( 20GP+20GP, NO+ =240)', ''],
      },
      {
        service: 'Truck fee',
        values: [
          '11 $/CBM Min 15 OR 1TON =35$',
          '',
          '',
          '1.5CBM=2CBM, 1.4CBM=1CBM',
          '',
          'INCREASE TRUCKING FEE 20% FOR SAK/JR',
        ],
      },
      {
        service: 'AUG ONWARD INCREASE',
        values: ['13 $/CBM Min 15 OR 1TON =40$', '', '', '', '', ''],
      },
      {
        service: 'Truck fee',
        values: ['', '200', '280', '', 'For Sportline / JR ( 20GP+20GP, NO+ =240)', ''],
      },
      {
        service: 'Truck fee',
        values: ['Extra, 30/40/50, 1.5/2.5/5 ton', '', '', '', 'For Sportline / JR', ''],
      },
      {
        service: 'APR ONWARD INCREASE',
        values: ['Extra, 30/40/50, 1.5/2.5/5 ton', '', '', '', 'For Sportline / JR', ''],
      },
      {
        service: 'Customs Acc',
        values: ['10', '10', '10', '10', '', ''],
      },
      {
        service: 'Customs Processing fee',
        values: ['13.75', '18.75', '18.75', '', 'as per receipt', ''],
      },
      {
        service: 'STORAGE',
        values: ['', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'DEMURRANGE',
        values: ['', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'SCAN FEE',
        values: ['', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'TRUCK STAND BY',
        values: ['50', '50', '50', '50', 'Per Ninght Per Truck', ''],
      },
      {
        service: 'Solve red signal',
        values: ['30', '30', '30', '30', '', ''],
      },
      {
        service: 'Add Declearation',
        values: ['30', '30', '30', '30', "all (LCL, 20', 40' )", ''],
      },
      {
        service: 'Add Customs Processing fee',
        values: ['10', '10', '10', '10', "all (LCL, 20', 40' )", ''],
      },
      {
        service: 'PERMIT',
        values: ['35', '35', '35', '35', 'EXPRESS', ''],
      },
      {
        service: 'Return empty',
        values: ['', '30', '50', '', '', ''],
      },
      {
        service: 'Over Weight',
        values: [
          '40 Ton all in (Truck+cargo) if over 1Ton 20$',
          '',
          '',
          '',
          'as per actual weight',
          '',
        ],
      },
      {
        service: 'WORDER',
        values: ['Cash by Cash', '', '', '', '', ''],
      },
    ],
  },
  {
    direction: 'EXPORT',
    port: 'AIRPORT',
    columns: ['LCL', '1.5 T', '2.5T', '5T', 'REMARK', ''],
    rows: [
      {
        service: 'CLEARANCE',
        values: ['60', '', '', '', '', ''],
      },
      {
        service: 'Truck',
        values: ['', '40', '55', '90', 'VFL / JYX', ''],
      },
      {
        service: 'Truck',
        values: ['', '50', '65', '110', 'For Sportline / JR', ''],
      },
      {
        service: 'Customs Acc',
        values: ['10', '10', '10', '10', '', ''],
      },
      {
        service: 'Customs Processing fee',
        values: ['13.75', '13.75', '13.75', '13.75', 'as per receipt', ''],
      },
      {
        service: 'OT DOCUMENT',
        values: ['50', '50', '50', '50', 'PER/SET', ''],
      },
      {
        service: 'CHECK IN SUNDAY',
        values: ['30', '30', '30', '30', 'PER/SET', ''],
      },
    ],
  },
  {
    direction: 'EXPORT',
    port: 'PNH',
    columns: ['SHP', '20G', '40', '', 'REMARK', ''],
    rows: [
      {
        service: 'CLEARANCE',
        values: ['', '65', '65', '', '', ''],
      },
      {
        service: 'Truck',
        values: ['', '160', '160', '', 'VFL / JYX', ''],
      },
      {
        service: 'Truck',
        values: [
          '',
          '200',
          '200',
          '',
          'For Sportline / JR',
          'INCREASE TRUCKING FEE 20% FOR SAK/JR',
        ],
      },
      {
        service: 'Customs Acc',
        values: ['', '10', '10', '', '', ''],
      },
      {
        service: 'Customs Processing fee',
        values: ['', '21.25', '21.25', '', 'as per receipt', ''],
      },
      {
        service: 'FINISH DOX AT PORT',
        values: ['', '30', '30', '', '', ''],
      },
      {
        service: 'LOLO AT PP PORT',
        values: ['', '50.6', '77', '', '', ''],
      },
      {
        service: 'COMISSION',
        values: [
          '5$ PER CTNR/SETS',
          '5$ PER CTNR/SETS',
          '5$ PER CTNR/SETS',
          '5$ PER CTNR/SETS',
          'Oil for lock seal at sportline',
          '',
        ],
      },
      {
        service: 'LOLO EMPTY',
        values: ['Base on Depot', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'Customs LOCK SEAL Cargo at Dry Port',
        values: ['', '30 one time', '30 one time', '', 'VFL / JYX', ''],
      },
      {
        service: 'Customs Inspection Cargo at Factory',
        values: ['', '50 one time', '50 one time', '', 'For Sportline / JR', ''],
      },
      {
        service: 'Gate fee for Lock Seal at Dry port',
        values: ['', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'STORAGE',
        values: ['', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'TRUCK STAND BY',
        values: ['', '50', '50', '', '50$ PER NIGHT PER TRUCK', ''],
      },
      {
        service: 'OT DOCUMENT',
        values: ['', '25', '25', '', '', ''],
      },
      {
        service: 'OT INSPECTION',
        values: ['', '35', '35', '', '', ''],
      },
      {
        service: 'LATE CTNR AT PORT',
        values: ['', 'TBA', 'TBA', '', '', ''],
      },
      {
        service: 'LATE DOCUMENT',
        values: ['', 'TBA', 'TBA', '', '', ''],
      },
      {
        service: 'OT CLEARANCE AT PORT',
        values: ['', '20', '20', '', '', ''],
      },
      {
        service: 'Add Declearation',
        values: ['30', '30', '30', '30', "all (LCL, 20', 40' )", ''],
      },
    ],
  },
  {
    direction: 'EXPORT',
    port: 'SHV',
    columns: ['', '20G', '40', '', 'REMARK', ''],
    rows: [
      {
        service: 'CLEARANCE',
        values: ['', '65', '65', '', '', ''],
      },
      {
        service: 'Truck',
        values: ['', '190', '190', '', 'VFL / JR', ''],
      },
      {
        service: 'Truck',
        values: ['', '230', '230', '', 'For Sportline / JR', ''],
      },
      {
        service: 'Customs Acc',
        values: ['', '10', '10', '', '', ''],
      },
      {
        service: 'Customs Processing fee',
        values: ['', '21.25', '21.25', '', 'as per receipt', ''],
      },
      {
        service: 'FINISH DOX AT PORT',
        values: ['', '35', '35', '', 'Per Container', ''],
      },
      {
        service: 'LOLO AT PP PORT',
        values: ['', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'COMISSION',
        values: ['', '5$ PER CTNR', '', '', 'Oil for lock seal at sportline', ''],
      },
      {
        service: 'LOLO EMPTY',
        values: ['', 'Base on Depot', '', '', 'as per receipt', ''],
      },
      {
        service: 'Customs Inspection Cargo at Dry Port',
        values: ['', '30 one time', '', '', 'VFL / JYX', ''],
      },
      {
        service: 'Customs Inspection Cargo at Factory',
        values: ['', '40', '', '', 'For Sportline / JR', ''],
      },
      {
        service: 'Gate fee for Lock Seal at Dry port',
        values: ['', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'STORAGE',
        values: ['', '', '', '', 'as per receipt', ''],
      },
      {
        service: 'TRUCK STAND BY',
        values: ['50', '50', '50', '50', 'PER NIGHT', ''],
      },
      {
        service: 'OT DOCUMENT',
        values: ['', '25', '25', '', '', ''],
      },
      {
        service: 'OT INSPECTION',
        values: ['', '35', '35', '', '', ''],
      },
      {
        service: 'LATE CTNR AT PORT',
        values: ['', 'TBA', 'TBA', '', '', ''],
      },
      {
        service: 'LATE DOCUMANT',
        values: ['', 'TBA', 'TBA', '', '', ''],
      },
      {
        service: 'Add Declearation',
        values: ['30', '30', '30', '30', "all (LCL, 20', 40' )", ''],
      },
    ],
  },
] as const;
